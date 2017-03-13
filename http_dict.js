var httpHeaders = require('know-your-http-well/json/headers.json');
var httpMethods = require('know-your-http-well/json/methods.json');
var httpMediaTypes = require('know-your-http-well/json/media-types.json');
var httpStatusCodes = require('know-your-http-well/json/status-codes.json');

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

module.exports = {
    httpDict
}