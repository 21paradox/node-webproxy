const http = require('http');
const https = require('https');
const url = require('url');
const serializeError = require('serialize-error');
const fetch = require('node-fetch');

const dns = require('dns')
dns.setServers([
    '1.1.1.1'
]);

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

const keepAliveAgent = new https.Agent({
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

    lib.compressReqCfg(reqConfig, async (err, reqCfgBase64) => {
        const proxyReq = https.request(CONF.pfx + '/proxyhttp', {
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


server.on('connect', async function (req, socket, head) {
    socket.pause();

    const parts = req.url.split(':');
    const host = parts[0];
    const port = parseInt(parts[1]) || 443;
    const opts = { host: host, port: port };
    const uid = uuid.v1();

    const remmoteRes = await fetch(CONF.pfx + '/httpsconnect', {
        headers: {
            uid: uid,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.25 Safari/537.36 Core/1.70.3756.400 QQBrowser/10.5.4039.400',
            conncfg: Buffer.from(JSON.stringify(opts)).toString('base64')
        }
    })

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
    }, 100, { 'maxWait': 400 });

    socket.on('data', function (buf) {
        bufQueue.push(buf);
        sendReq();
    });

    remmoteRes.body.on('data', function (data) {
        // console.log('222')
        socket.write(data);
    });

    remmoteRes.body.on('end', function () {
        socket.destroy();
    });

    socket.on('error', (e) => {
        // console.log(e)
    })
    socket.resume();
});


function _synReply({ socket, code, reason, headers }) {
    const statusLine = 'HTTP/1.1 ' + code + ' ' + reason + '\r\n';
    let headerLines = '';
    for (let key in headers) {
        headerLines += key + ': ' + headers[key] + '\r\n';
    }
    try {
        socket.write(statusLine + headerLines + '\r\n', 'UTF-8');
    } catch (e) {
        console.log(e)
    }
}

function doHttpUp(cfg) {
    const { uid, buf } = cfg
    const sendReq = fetch(CONF.pfx + '/httpsup', {
        method: 'post',
        headers: {
            uid,
        },
        body: buf,
    })
    return sendReq
}


server.listen(CONF.local_port, function () {
    console.log(`listening on ${CONF.local_port}`);
});