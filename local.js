const http = require('http');
const url = require('url');
const crypto = require('crypto');
const zlib = require('zlib');
const serializeError = require('serialize-error');

const server = http.createServer();

const keepAliveAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 50 * 1000,
});

const lib = require('./lib');

// https://github.com/jshttp/cookie/blob/master/index.js#L28
const fieldContentRegExp = /^[\u0009\u0020-\u007e\u0080-\u00ff]+$/;
const fieldContentRegExpReplace = /[^\u0009\u0020-\u007e\u0080-\u00ff]/g;

const CONF = require('./config.json');

server.on('request', function (req, res) {

    const parsed = url.parse(req.url);
    const headers = req.headers;
    // remove invalid cookie
    if (headers.cookie) {
        if (fieldContentRegExp.test(headers.cookie) === false) {
            headers.cookie = headers.cookie.replace(fieldContentRegExpReplace, '');
        }
    }

    const reqConfig = {
        host: parsed.host,
        port: parsed.port || 80,
        path: parsed.path,
        method: req.method,
        headers: headers
    };

    lib.compressReqCfg(reqConfig, function (err, reqCfgBase64) {

        const proxyReq = http.request({
            hostname: CONF.hostname,
            port: 8002,
            path: '/proxyhttp',
            headers: {
                reqcfg: reqCfgBase64
            },
            method: reqConfig.method,
            agent: keepAliveAgent
        });

        proxyReq.on('response', function (remmoteRes) {
            res.writeHead(remmoteRes.statusCode, remmoteRes.headers);
            remmoteRes.pipe(res);
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
});

const uuid = require('uuid');
const _ = require('lodash');


server.on('connect', function (req, socket, head) {

    socket.pause();

    const parts = req.url.split(':');
    const host = parts[0];
    const port = parseInt(parts[1]) || 443;
    const opts = { host: host, port: port };
    const uid = uuid.v1();

    const connectReq = http.request({
        hostname: CONF.hostname,
        port: CONF.remote_port,
        path: '/httpsconnect',
        headers: {
            uid: uid,
            conncfg: Buffer.from(JSON.stringify(opts)).toString('base64')
        },
        method: 'GET',
        agent: keepAliveAgent
    });

    connectReq.on('response', function (remmoteRes) {
        _synReply({
            socket,
            code: 200,
            reason: 'Connection established',
            headers: {
                'Connection': 'keep-alive'
            },
        });

        let bufQueue = [];
        let sendReq = _.debounce(function () {
            const queueToSend = Buffer.concat(bufQueue);
            bufQueue = [];

            doHttpUp({
                uid,
                buf: queueToSend
            });
        }, 300, { 'maxWait': 400 });

        socket.on('data', function (buf) {
            bufQueue.push(buf);
            sendReq();
        });

        remmoteRes.on('data', function (data) {
            socket.write(data);
        });

        remmoteRes.on('end', function () {
            socket.destroy();
        });

        socket.resume();
    });

    connectReq.on('error', function () {
        _synReply({
            socket,
            code: 502,
            reason: 'connect remote error',
            headers: {}
        });
    });

    connectReq.end();
});


function _synReply({ socket, code, reason, headers }) {
    const statusLine = 'HTTP/1.1 ' + code + ' ' + reason + '\r\n';
    let headerLines = '';
    for (let key in headers) {
        headerLines += key + ': ' + headers[key] + '\r\n';
    }
    socket.write(statusLine + headerLines + '\r\n', 'UTF-8');
}

function doHttpUp(cfg) {
    const { uid, buf } = cfg;
    const dataReq = http.request({
        hostname: CONF.hostname,
        port: CONF.remote_port,
        path: '/httpsup',
        headers: {
            uid: uid,
            'Content-Length': Buffer.byteLength(buf)
        },
        method: 'GET',
        agent: keepAliveAgent
    });

    dataReq.on('error', function (e) {
        console.log(e)
    });

    dataReq.write(buf);
    dataReq.end();
}


server.listen(CONF.local_port, function() {
    console.log(`listening on ${CONF.local_port}`);
});