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
  if (req.method.toLowerCase() === 'options') {
    let allowHeaders = "*";
    const accessHeaders = req.headers['Access-Control-Request-Headers']
    if (accessHeaders) {
      allowHeaders = accessHeaders
    }
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('Access-Control-Allow-Headers', allowHeaders)
    res.setHeader('access-control-allow-methods', "GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS")
    res.setHeader('access-control-max-age', '1728000')
    res.statusCode = 204
    res.end('')
    return
  }

  const url1 = req.url.replace(/^\//, '')
  const url2 = encryptUrl(url1)
  req.url = '/' +url2

  res.setHeader('access-control-allow-origin', '*')
  proxy.web(req, res, {
    target: conf.cfOrigin,
    agent: httpAgent,
    changeOrigin: true,
    toProxy: true,
  });
});

server.listen(conf.cfPort);
console.log('listen ' + conf.cfPort)
