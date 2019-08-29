const http = require('http');

const EventEmitter = require('events');
const net = require('net');
const serializeError = require('serialize-error');
const lib = require('./lib');

const ee = new EventEmitter();

const keepAliveAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 50 * 1000,
});

const CONF = require('./config.json');

const server = http.createServer(async (req, res) => {
  if (req.url === '/proxyhttp') {
    const reqcfgRaw = req.headers.reqcfg;

    if (!reqcfgRaw) {
      res.statusCode = 500;
      res.end(
        JSON.stringify({
          msg: 'should provide reqcfg',
        }),
      );
      return;
    }

    const reqcfg = await lib.decompressCfg(reqcfgRaw);
    // eslint-disable-next-line no-param-reassign
    reqcfg.agent = keepAliveAgent;
    const proxyReq = http.request(reqcfg);

    proxyReq.on('response', async (remoteRes) => {
      const resHeadStr = await lib.compressReqCfg(remoteRes.headers);
      res.writeHead(remoteRes.statusCode, {
        resHeadStr,
      });
      const bufStream = lib.copyRes(remoteRes);
      const dstream = bufStream.pipe(lib.dataToLine());
      dstream.pipe(res);
    });

    req.pipe(proxyReq);

    proxyReq.on('error', (err) => {
      const errstr = JSON.stringify(serializeError(err), null, 4);
      if (err.code === 'ENOTFOUND') {
        res.writeHead(404);
      } else {
        res.writeHead(500);
      }
      console.log(err, 'proxyReq');
      res.end(errstr);
      res.isEnd = true;
    });
  } else if (req.url === '/httpsconnect') {
    const conncfgRaw = Buffer.from(req.headers.conncfg, 'base64');
    const conncfg = JSON.parse(conncfgRaw);
    const { uid } = req.headers;

    if (!conncfg) {
      res.statusCode = 500;
      res.end('should provide reqcfg');
      return;
    }

    console.log({
      conncfg,
    });

    const target = net.connect(conncfg);
    let connected = false;
    let err = null;

    target.on('connect', () => {
      connected = true;

      res.writeHead(200, {});
      // eslint-disable-next-line no-underscore-dangle
      res._send('');
    });

    const bufStream = lib.copyRes(target);
    // const bufStream = target;
    const dstream = bufStream.pipe(lib.dataToLine());
    dstream.pipe(res);

    ee.on(uid, (data) => {
      target.write(data);
    });

    req.on('aborted', () => {
      console.log('aborted')
      target.end();
    });

    target.on('close', () => {
      if (err) {
        const errstr = JSON.stringify(serializeError(err), null, 4);
        res.end(errstr);
      } else {
        // res.end();
      }
      console.log('onclose', err);
      setTimeout(() => {
        ee.removeAllListeners(uid);
      }, 2000);
    });

    target.on('error', (_err) => {
      err = _err;
      console.log({
        _err,
        conncfg,
      });
      if (!connected) {
        res.writeHead(500);
      }
    });
  } else if (req.url === '/httpsup') {
    const { uid } = req.headers;

    if (!uid) {
      res.statusCode = 500;
      res.end('should provide uid');
      return;
    }

    req.on('data', (data) => {
      ee.emit(uid, data);
    });

    req.on('end', () => {
      res.statusCode = 200;
      res.end();
    });
  } else {
    res.end('asd');
  }
});

let port;

if (process.env.PORT) {
  port = parseInt(process.env.PORT, 10);
} else {
  port = parseInt(CONF.remote_port, 10);
}

server.listen(port, '0.0.0.0', () => {
  console.log(`listening on ${CONF.remote_port}`);
});
