var httpHeaders = require('know-your-http-well/json/headers.json');
var httpMethods = require('know-your-http-well/json/methods.json');
var httpMediaTypes = require('know-your-http-well/json/media-types.json');
var httpStatusCodes = require('know-your-http-well/json/status-codes.json');
var zlib = require('zlib');


var dictArr = [];

httpHeaders.forEach((v) => {
    dictArr.push(v.header.toLowerCase());
});

httpMethods.forEach((v) => {
    dictArr.push(v.method.toLowerCase());
})

httpMediaTypes.forEach((v) => {
    dictArr.push(v.media_type);
});

httpStatusCodes.forEach((v) => {
    dictArr.push(v.code);
});

var newDict = dictArr.join('');
var httpDict = Buffer.from(newDict);



function compressReqCfg(reqConfig, cb) {

    let reqCfgRaw = JSON.stringify(reqConfig);
    reqCfgRaw = Buffer.from(reqCfgRaw)

    zlib.deflate(reqCfgRaw, {
        dictionary: httpDict,
        level: 9
    }, (err, buf) => {

        if (err) {
            cb(err)
        } else {

            let reqCfgBase64 = buf.toString('base64');
            cb(null, reqCfgBase64);
        }
    });
}


function decompressCfg(base64Str, cb) {

    let reqcfgBuffer = Buffer.from(base64Str, 'base64');
 
    zlib.inflate(reqcfgBuffer, {
        dictionary: httpDict,
    }, (err, buf) => {
        if (err) {
            cb(err)
        } else {
            let reqCfgStr = buf.toString()
            let reqcfg = JSON.parse(reqCfgStr);
            cb(null, reqcfg);
        }
    });

}




module.exports = {
    httpDict,
    compressReqCfg,
    decompressCfg
}