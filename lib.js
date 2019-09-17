const httpHeaders = require('know-your-http-well/json/headers.json');
const httpMethods = require('know-your-http-well/json/methods.json');
const httpMediaTypes = require('know-your-http-well/json/media-types.json');
const httpStatusCodes = require('know-your-http-well/json/status-codes.json');
const zlib = require('zlib');
const crypto = require('crypto');
const OSS = require('ali-oss');
const stream = require('stream');
const CONF = require('./config.json');
const _ = require('lodash')

const dictArr = [];

httpHeaders.forEach((v) => {
  dictArr.push(v.header.toLowerCase());
});

httpMethods.forEach((v) => {
  dictArr.push(v.method.toLowerCase());
});

httpMediaTypes.forEach((v) => {
  dictArr.push(v.media_type);
});

httpStatusCodes.forEach((v) => {
  dictArr.push(v.code);
});

const newDict = dictArr.join('');
const httpDict = Buffer.from(newDict);

function compressReqCfg(reqConfig) {
  let reqCfgRaw = JSON.stringify(reqConfig);
  reqCfgRaw = Buffer.from(reqCfgRaw);

  return new Promise((resolve, reject) => {
    zlib.deflate(
      reqCfgRaw,
      {
        dictionary: httpDict,
        level: 9,
      },
      (err, buf) => {
        if (err) {
          reject(err);
        } else {
          const reqCfgBase64 = buf.toString('base64');
          resolve(reqCfgBase64);
        }
      },
    );
  });
}

function decompressCfg(base64Str) {
  const reqcfgBuffer = Buffer.from(base64Str, 'base64');
  return new Promise((resolve, reject) => {
    zlib.inflate(
      reqcfgBuffer,
      {
        dictionary: httpDict,
      },
      (err, buf) => {
        if (err) {
          reject(err);
        } else {
          const reqCfgStr = buf.toString();
          const reqcfg = JSON.parse(reqCfgStr);
          resolve(reqcfg);
        }
      },
    );
  });
}

function getMd5(buf) {
  return crypto
    .createHash('md5')
    .update(buf)
    .digest('hex');
}

const ossClient = new OSS({
  accessKeyId: process.env.accessKeyId || CONF.accessKeyId,
  accessKeySecret: process.env.accessKeySecret || CONF.accessKeySecret,
  bucket: process.env.bucket || CONF.bucket,
  region: process.env.region || CONF.region,
});

function addPrefix(str) {
  return `proxy/${str}`;
}
function removePrefix(str) {
  return str.replace(/^proxy\//, '');
}

function copyRes(res) {
  let bufArr = [];
  function batchSend() {
    bufStream.push(Buffer.concat(bufArr));
    bufArr = [];
  }
  const debounceFlush = _.debounce(() => {
    batchSend();
  }, 50, { maxWait: 200 });

  const bufStream = new stream.Transform({
    transform(data, encoding, callback) {
      bufArr.push(data);
      let totalByte = 0;
      bufArr.forEach((buf) => {
        if (buf) {
          totalByte += buf.length;
        }
      });
      if (totalByte > 512 * 1024) {
        batchSend();
      } else {
        debounceFlush();
      }
      callback();
    },
    readableHighWaterMark: 1024 * 1024,
    writableHighWaterMark: 1024 * 1024,
  });
  res.on('error', (e) => {
    console.log(e);
  });
  res.pipe(bufStream);
  return bufStream;
}

function removeFirst(arr, item) {
  arr.some((v, index) => {
    if (v === item) {
      arr.splice(index, 1);
      return true;
    }
    return false;
  });
}

function pTransform(fn, cfg = {}) {
  const sendArr = [];
  const concurrency = cfg.concurrency || process.env.concurrency || CONF.concurrency || 5;

  const pstream = new stream.Transform({
    readableHighWaterMark: cfg.readableHighWaterMark,
    writableHighWaterMark: cfg.writableHighWaterMark,
    final(finalCb) {
      console.log('final', sendArr);
      Promise.all(sendArr).then(() => {
        console.log('call final');
        process.nextTick(() => {
          finalCb();
        });
      });
    },
    async transform(data, encoding, callback) {
      const self = this;
      const sendP = new Promise((resolve, reject) => {
        fn.call(self, data, encoding, (err, sendData) => {
          if (err) {
            reject(err);
          } else {
            resolve(sendData);
          }
        });
      });
      sendArr.push(sendP);

      //  throttle
      if (sendArr.length >= concurrency) {
        await Promise.all(sendArr.slice());
        const sendData = await sendP;
        removeFirst(sendArr, sendP);
        callback(null, sendData);
        return;
      }

      process.nextTick(() => {
        callback();
      });
      await Promise.all(sendArr.slice());
      const sendData = await sendP;

      removeFirst(sendArr, sendP);
      this.push(sendData);
    },
  });
  return pstream;
}

const splitChar = 'ψψψ';

function dataToLine() {
  let isEnd = false;
  let timer;
  const pingBeforeIdle = (curStream) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      if (isEnd) {
        return;
      }
      console.log('send ping');
      curStream.push(splitChar);
      pingBeforeIdle(curStream);
    }, 40 * 1000);
  };

  const transform = function (chunk, enc, callback) {
    const md5 = getMd5(chunk);
    const key = addPrefix(md5);
    const self = this;

    if (chunk.length > 20 * 1024) {
      console.log('send: ', key);
      ossClient.put(key, chunk)
        .catch(() => ossClient.put(key, chunk))
        .catch(() => ossClient.put(key, chunk))
        .then(() => {
          console.log(`send finish: ${key}`);
          callback(null, key + splitChar);
          pingBeforeIdle(self);
        });
    } else {
      console.log(`send: ${getMd5(chunk)}`);
      callback(null, Buffer.concat([
        chunk,
        Buffer.from(splitChar, 'utf-8'),
      ]));
      pingBeforeIdle(self);
    }
  };

  const dstream = pTransform(transform, {
    readableHighWaterMark: 1024 * 1024,
    writableHighWaterMark: 1024 * 1024,
  });

  function cleanPing() {
    isEnd = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  dstream.on('end', () => {
    console.log('clean ping end')
    cleanPing();
  });

  dstream.on('close', () => {
    console.log('clean ping close')
    cleanPing();
    dstream.destroy();
  });

  dstream.on('error', (e) => {
    console.log(e);
    cleanPing();
    dstream.destroy();
  });

  return dstream;
}

function wait(time) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
}

function lineToDataStrip() {
  const transform = function (chunk, enc, callback) {
    const lineStr = chunk.slice(0, 6).toString();
    console.log('size: ', chunk.length);

    if (lineStr.match(/^proxy\//)) {
      console.log(`get: ${chunk.slice(0, 40).toString()}`);
      const key = chunk.toString();
      ossClient.get(key)
        .catch(() => wait(100).then(() => ossClient.get(key)))
        .catch(() => wait(3000).then(() => ossClient.get(key)))
        .catch(() => wait(5000).then(() => ossClient.get(key)))
        .then((result) => {
          console.log(`get finish: ${chunk.slice(0, 40).toString()}`);
          callback(null, result.content);
        })
        .catch((e) => {
          console.log('error', key);
          callback(e);
        });
    } else {
      console.log(`get: ${getMd5(chunk)}`);
      callback(null, chunk);
    }
  };
  const rs = pTransform(transform);
  return rs;
}


module.exports = {
  httpDict,
  compressReqCfg,
  decompressCfg,
  getMd5,
  addPrefix,
  removePrefix,
  dataToLine,
  ossClient,
  copyRes,
  splitChar,
  lineToDataStrip,
};
