const http = require('http');
const url = require('url');

const lib = require('./lib');
const EventEmitter = require('events');
const net = require('net');
const serializeError = require('serialize-error');

const ee = new EventEmitter();

const keepAliveAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 50 * 1000,
});

const CONF = require('./config.json');

const server = http.createServer(function (req, res) {

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
            reqcfg.agent = keepAliveAgent;
            var proxyReq = http.request(reqcfg);

            proxyReq.on('response', function (remoteRes) {
                res.writeHead(remoteRes.statusCode, remoteRes.headers);
                remoteRes.pipe(res);
            });

            req.pipe(proxyReq);

            proxyReq.on('error', function (err) {
                let errstr = JSON.stringify(serializeError(err), null, 4);
                if ('ENOTFOUND' == err.code) {
                    res.writeHead(404);
                } else {
                    res.writeHead(500);
                }
                res.end(errstr);
            });
        });

    } else if (req.url === '/httpsconnect') {

        let conncfgRaw = Buffer.from(req.headers.conncfg, 'base64');
        let conncfg = JSON.parse(conncfgRaw);
        let uid = req.headers.uid;

        if (!conncfg) {
            res.statusCode = 500;
            res.end('should provide reqcfg');
            return;
        }

        let target = net.connect(conncfg);
        let connected = false;
        let err = null;

        target.on('connect', function () {
            connected = true;

            res.writeHead(200, {});
            res._send('');
        });

        target.on('data', function (data) {
            res.write(data);
        });

        ee.on(uid, function (data) {
            target.write(data);
        });

        target.on('close', function () {
            if (err) {
                let errstr = JSON.stringify(serializeError(err), null, 4);
                res.end(errstr);
            } else {
                res.end();
            }
            ee.removeAllListeners(uid);
        });

        target.on('error', function (_err) {
            err = _err;

            if (!connected) {
                res.writeHead(500);
            }
        });

    } else if (req.url === '/httpsup') {

        let uid = req.headers.uid;

        if (!uid) {
            res.statusCode = 500;
            res.end('should provide uid');
            return;
        }

        req.on('data', function (data) {
            ee.emit(uid, data);
        });

        req.on('end', function () {
            res.statusCode = 200;
            res.end();
        });

    } else {
        res.end('asd');
    }
});


let port;

if (process.env.remote_port) {
    port = parseInt(process.env.remote_port);
} else {
    port = parseInt(CONF.remote_port);
}

server.listen(port, function() {
    console.log(`listening on ${CONF.remote_port}`);
});