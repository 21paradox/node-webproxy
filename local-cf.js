var httpProxy = require('http-proxy');
const http = require('http');
const conf = require('./config.json')

const staticLookup = (ip, v) => (hostname, opts, cb) => cb(null, ip, v || 4);

function encryptUrl(str) {
  const a = str.split('').reverse().join('');
  return encodeURIComponent(a);
}

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 50 * 1000,
  lookup: staticLookup(conf.cfip, 4),
});

const proxy = httpProxy.createProxyServer(); // See (†)

const server = http.createServer(function (req, res) {
  const url1 = req.url.replace(/^\//, '')
  req.url = '/' + encryptUrl(url1)

  proxy.web(req, res, {
    target: conf.cfOrigin,
    agent: httpAgent,
    changeOrigin: true,
    toProxy: true,
  });
});

server.listen(8866);
