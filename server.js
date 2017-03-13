var http = require('http');
var url = require('url');
var zlib = require('zlib');

var lib = require('./lib');

var keepAliveAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 50 * 1000,
});

var server = http.createServer(function (req, res) {

    if (req.url === '/proxyhttp') {

        let reqcfgRaw = req.headers.reqcfg;

        if (!reqcfgRaw) {
            res.statusCode = 500;
            res.end(JSON.stringify({
                msg: 'should provide reqcfg'
            }))
            return;
        }

        lib.decompressCfg(reqcfgRaw, function (err, reqcfg) {

            console.log(reqcfg);

            //reqcfg.agent = keepAliveAgent;

            var proxyReq = http.request(reqcfg);

            proxyReq.on('response', function (remoteRes) {

                console.log(remoteRes.headers);

                res.writeHead(remoteRes.statusCode, remoteRes.headers);
                remoteRes.pipe(res);
            });

            req.pipe(proxyReq);
        });

    } else {
        res.end('asd');
    }
});


server.listen(8002);