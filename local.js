const http = require('http');
const https = require('https');
const url = require('url');
const crypto = require('crypto');
const zlib = require('zlib');
const serializeError = require('serialize-error');

const split = require('split');
const server = http.createServer();


const lib = require('./lib');

// https://github.com/jshttp/cookie/blob/master/index.js#L28
const fieldContentRegExp = /^[\u0009\u0020-\u007e\u0080-\u00ff]+$/;
const fieldContentRegExpReplace = /[^\u0009\u0020-\u007e\u0080-\u00ff]/g;

const CONF = require('./config.json');

let sender;
if (CONF.remote_port === 443) {
    sender = https;
} else {
    sender = http;
}

const keepAliveAgent = new sender.Agent({
    keepAlive: true,
    keepAliveMsecs: 50 * 1000,
});

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
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.path,
        method: req.method,
        headers: headers
    };

    lib.compressReqCfg(reqConfig, function (err, reqCfgBase64) {

        const proxyReq = sender.request({
            hostname: CONF.hostname,
            port: CONF.remote_port,
            path: '/proxyhttp',
            headers: {
                reqcfg: reqCfgBase64
            },
            method: reqConfig.method,
            agent: keepAliveAgent
        });

        proxyReq.on('response', function (remoteRes) {
            res.writeHead(remoteRes.statusCode, remoteRes.headers);
            const splitStream = remoteRes.pipe(split());

            splitStream.on('data', (line) => {
                splitStream.pause();
                if (!line) {
                    return;
                }
                lib.ossClient.get(line).then((result) => {
                    if(!res.isEnd) {

                    res.write(result.content);
                    splitStream.resume();
                    }
                })
                .catch((e) => {
                    console.log(e, line);
                })
            });
            remoteRes.on('end', () => {
                res.end();
            })
            // remoteRes.pipe(res);
        });

        req.pipe(proxyReq);

        proxyReq.on('error', function (err) {
            let errstr = JSON.stringify(serializeError(err), null, 4);
            if ('ENOTFOUND' == err.code) {
                res.writeHead(404);
            } else {
                res.writeHead(500);
            }
            if (err.bytesParsed > 400) {
                res.end(errstr);
                res.isEnd = true;
            }
            console.log(errstr)
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

    const connectReq = sender.request({
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

        socket.on('error', (e) => {
            console.log(e)
        })

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
    const dataReq = sender.request({
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


server.listen(CONF.local_port, function () {
    console.log(`listening on ${CONF.local_port}`);
});