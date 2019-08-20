const httpHeaders = require('know-your-http-well/json/headers.json');
const httpMethods = require('know-your-http-well/json/methods.json');
const httpMediaTypes = require('know-your-http-well/json/media-types.json');
const httpStatusCodes = require('know-your-http-well/json/status-codes.json');
const zlib = require('zlib');
const crypto = require('crypto');
const { Transform } = require('stream');
const OSS = require('ali-oss');
const streamBuffers = require('stream-buffers');
const CONF = require('./config.json');

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

function compressReqCfg(reqConfig, cb) {
  let reqCfgRaw = JSON.stringify(reqConfig);
  reqCfgRaw = Buffer.from(reqCfgRaw);

  zlib.deflate(
    reqCfgRaw,
    {
      dictionary: httpDict,
      level: 9,
    },
    (err, buf) => {
      if (err) {
        cb(err);
      } else {
        const reqCfgBase64 = buf.toString('base64');
        cb(null, reqCfgBase64);
      }
    },
  );
}

function decompressCfg(base64Str, cb) {
  const reqcfgBuffer = Buffer.from(base64Str, 'base64');

  zlib.inflate(
    reqcfgBuffer,
    {
      dictionary: httpDict,
    },
    (err, buf) => {
      if (err) {
        cb(err);
      } else {
        const reqCfgStr = buf.toString();
        const reqcfg = JSON.parse(reqCfgStr);
        cb(null, reqcfg);
      }
    },
  );
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
  const bufStream = new streamBuffers.ReadableStreamBuffer({
    frequency: 300, // in milliseconds.
    chunkSize: 128 * 1024, // in bytes.
  });
  // remoteRes.pipe(bufStream); // 300ms cache
  res.on('data', (data) => {
    bufStream.put(data);
  });
  res.on('end', () => {
    bufStream.stop();
  });
  res.on('error', (e) => {
    console.log(e);
  });
  return bufStream;
}

const splitChar = 'ψψψ';
const stripSplit = new RegExp(`${splitChar}$`);

function dataToLine() {
  const transform = (chunk, encoding, callback) => {
    const md5 = getMd5(chunk);
    const key = addPrefix(md5);

    if (chunk.length > 20 * 1024) {
      ossClient.put(key, chunk).then(() => {
        callback(null, key + splitChar);
      });
    } else {
      callback(null, chunk);
    }
  };

  const dstream = new Transform({
    transform,
  });
  return dstream;
}


function lineToDataStrip() {
  const transform = function (chunk, enc, callback) {
    const lineStr = chunk.slice(0, 6).toString();

    if (lineStr.match(/^proxy\//)) {
      const key = chunk.toString().replace(stripSplit, '');
      ossClient.get(key).then((result) => {
        callback(null, result.content);
      });
    } else {
      callback(null, chunk);
    }
  };

  const rs = new Transform({
    transform,
  });
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
