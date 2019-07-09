const httpHeaders = require("know-your-http-well/json/headers.json");
const httpMethods = require("know-your-http-well/json/methods.json");
const httpMediaTypes = require("know-your-http-well/json/media-types.json");
const httpStatusCodes = require("know-your-http-well/json/status-codes.json");
const zlib = require("zlib");
const crypto = require("crypto");
const _ = require('lodash');
const  Transform  = require('stream').Transform
const CONF = require('./config.json');
const OSS = require('ali-oss');

const dictArr = [];

httpHeaders.forEach(v => {
  dictArr.push(v.header.toLowerCase());
});

httpMethods.forEach(v => {
  dictArr.push(v.method.toLowerCase());
});

httpMediaTypes.forEach(v => {
  dictArr.push(v.media_type);
});

httpStatusCodes.forEach(v => {
  dictArr.push(v.code);
});

const newDict = dictArr.join("");
const httpDict = Buffer.from(newDict);

function compressReqCfg(reqConfig, cb) {
  let reqCfgRaw = JSON.stringify(reqConfig);
  reqCfgRaw = Buffer.from(reqCfgRaw);

  zlib.deflate(
    reqCfgRaw,
    {
      dictionary: httpDict,
      level: 9
    },
    (err, buf) => {
      if (err) {
        cb(err);
      } else {
        const reqCfgBase64 = buf.toString("base64");
        cb(null, reqCfgBase64);
      }
    }
  );
}

function decompressCfg(base64Str, cb) {
  const reqcfgBuffer = Buffer.from(base64Str, "base64");

  zlib.inflate(
    reqcfgBuffer,
    {
      dictionary: httpDict
    },
    (err, buf) => {
      if (err) {
        cb(err);
      } else {
        const reqCfgStr = buf.toString();
        const reqcfg = JSON.parse(reqCfgStr);
        cb(null, reqcfg);
      }
    }
  );
}

function getMd5(buf) {
  return crypto
    .createHash("md5")
    .update(buf)
    .digest("hex");
}

// function pushDebounce(cb) {
//   let bufQueue = [];
//   let endCb;
//   const runFn = _.debounce(() => {
//     const queueToSend = Buffer.concat(bufQueue);
//     bufQueue = [];

//     cb(queueToSend, endCb);
//   },
//     300,
//     { maxWait: 400 }
//   );

//   function push(buf) {
//     bufQueue.push(buf);
//     runFn();
//   }

//   function onEnd(callback) {
//     if (bufQueue.length > 0) {
//       endCb = callback;
//     } else {
//       callback();
//     }
//   }

//   return {
//     push,
//     onEnd,
//   };
// }

function addPrefix(str) {
  return 'proxy/' + str;
}
function removePrefix(str) {
  return str.replace(/^proxy\//, '')
}

function wait(time) {
  return new Promise((resolve) => {
      setTimeout(() => {
          resolve();
      }, time)
  })
}


function debounceStream() {
  const transform = (chunk, encoding, callback) => {
      callback(null, chunk);
  }
  const dstream = new Transform({
    transform: _.debounce(transform, 300, { maxWait: 3000 })
  });
  return dstream
}

const ossClient = new OSS({
  accessKeyId: process.env.accessKeyId,
  accessKeySecret: process.env.accessKeySecret,
  bucket: CONF.bucket,
  region: CONF.region,
});


module.exports = {
  httpDict,
  compressReqCfg,
  decompressCfg,
  // pushDebounce,
  getMd5,
  addPrefix,
  removePrefix,
  wait,
  debounceStream,
  ossClient,
};
