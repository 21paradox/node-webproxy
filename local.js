var http = require('http');
var url = require('url');
var crypto = require('crypto');
var zlib = require('zlib');

var server = http.createServer();

var keepAliveAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 50 * 1000,
});

var lib = require('./lib');

server.on('request', function (req, res) {

    var parsed = url.parse(req.url);

    const reqConfig = {
        host: parsed.host,
        port: parsed.port || 80,
        path: parsed.path,
        method: req.method,
        headers: req.headers
    };

    lib.compressReqCfg(reqConfig, function (err, reqCfgBase64) {

        var proxyReq = http.request({
            hostname: 'localhost',
            port: 8002,
            path: '/proxyhttp',
            headers: {
                reqcfg: reqCfgBase64
            },
            method: reqConfig.method,
            agent: keepAliveAgent
        });

        proxyReq.on('response', function (remmoteRes) {
            console.log(remmoteRes.headers);
            res.writeHead(remmoteRes.statusCode, remmoteRes.headers);
            remmoteRes.pipe(res);

        });

        req.pipe(proxyReq);
    });


});

server.listen(8001);