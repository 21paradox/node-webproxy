const http = require('http');
const https = require('https');
const url = require('url');
const serializeError = require('serialize-error');

const server = http.createServer();

const uuid = require('uuid');
const _ = require('lodash');
const lib = require('./lib');
const split = require('binary-split')

// https://github.com/jshttp/cookie/blob/master/index.js#L28
// eslint-disable-next-line no-control-regex
const fieldContentRegExp = /^[\u0009\u0020-\u007e\u0080-\u00ff]+$/;
// eslint-disable-next-line no-control-regex
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

server.on('request', (req, res) => {
  const parsed = url.parse(req.url);
  const { headers } = req;
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
    headers,
  };

  lib.compressReqCfg(reqConfig, (errdec, reqCfgBase64) => {
    const proxyReq = sender.request({
      hostname: CONF.hostname,
      port: CONF.remote_port,
      path: '/proxyhttp',
      headers: {
        reqcfg: reqCfgBase64,
      },
      method: reqConfig.method,
      agent: keepAliveAgent,
    });

    proxyReq.on('response', (remoteRes) => {
      res.writeHead(remoteRes.statusCode, remoteRes.headers);
      //  const dataStream = remoteRes.pipe(split(lib.splitChar)).pipe(lib.lineToData());
      const dataStream = remoteRes.pipe(split(lib.splitChar)).pipe(lib.lineToDataStrip());
      dataStream.pipe(res);
    });

    req.pipe(proxyReq);

    proxyReq.on('error', (err) => {
      const errstr = JSON.stringify(serializeError(err), null, 4);
      if (err.code === 'ENOTFOUND') {
        res.writeHead(404);
      } else {
        res.writeHead(500);
      }
      if (err.bytesParsed > 400) {
        res.end(errstr);
        res.isEnd = true;
      }
      console.log(errstr, 'errstr');
    });
  });
});

// eslint-disable-next-line no-underscore-dangle
function _synReply({
  socket, code, reason, headers,
}) {
  const statusLine = `HTTP/1.1 ${code} ${reason}\r\n`;
  let headerLines = '';
  Object.keys(headers).forEach((key) => {
    headerLines += `${key}: ${headers[key]}\r\n`;
  });
  socket.write(`${statusLine + headerLines}\r\n`, 'UTF-8');
}

function doHttpUp(cfg) {
  const { uid, buf } = cfg;
  const dataReq = sender.request({
    hostname: CONF.hostname,
    port: CONF.remote_port,
    path: '/httpsup',
    headers: {
      uid,
      'Content-Length': Buffer.byteLength(buf),
    },
    method: 'GET',
    agent: keepAliveAgent,
  });

  dataReq.on('error', (e) => {
    console.log(e, 'dataReq');
  });

  dataReq.write(buf);
  dataReq.end();
}

server.on('connect', (req, socket) => {
  socket.pause();

  const parts = req.url.split(':');
  const host = parts[0];
  const port = parseInt(parts[1], 10) || 443;
  const opts = { host, port };
  const uid = uuid.v1();

  const connectReq = sender.request({
    hostname: CONF.hostname,
    port: CONF.remote_port,
    path: '/httpsconnect',
    headers: {
      uid,
      conncfg: Buffer.from(JSON.stringify(opts)).toString('base64'),
    },
    method: 'GET',
    agent: keepAliveAgent,
  });

  connectReq.on('response', (remoteRes) => {
    _synReply({
      socket,
      code: 200,
      reason: 'Connection established',
      headers: {
        Connection: 'keep-alive',
      },
    });

    let bufQueue = [];
    const sendReq = _.debounce(
      () => {
        const queueToSend = Buffer.concat(bufQueue);
        bufQueue = [];

        doHttpUp({
          uid,
          buf: queueToSend,
        });
      },
      300,
      { maxWait: 400 },
    );

    socket.on('data', (buf) => {
      bufQueue.push(buf);
      sendReq();
    });

    const dataStream = remoteRes.pipe(lib.lineToDataStrip());
    dataStream.pipe(socket);

    remoteRes.on('end', () => {
      socket.destroy();
    });
    socket.on('error', (e) => {
      console.log(e, 'socket-err');
    });
    socket.resume();
  });

  connectReq.on('error', () => {
    _synReply({
      socket,
      code: 502,
      reason: 'connect remote error',
      headers: {},
    });
  });

  connectReq.end();
});


server.listen(CONF.local_port, () => {
  console.log(`listening on ${CONF.local_port}`);
});
