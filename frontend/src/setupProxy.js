const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Proxy API requests
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:8093',
      changeOrigin: true,
      ws: false,
      logLevel: 'silent',
    })
  );

  // Proxy specific WebSocket paths only (avoid React dev server conflict)
  app.use(
    createProxyMiddleware(['/ws/logs/**', '/ws/stats/**'], {
      target: 'http://localhost:8093',
      ws: true,
      changeOrigin: true,
      logLevel: 'silent',
      onProxyReqWs: (proxyReq, req, socket) => {
        console.log('App WebSocket proxy:', req.url);
      },
      onError: (err, req, res) => {
        console.error('App WebSocket proxy error:', err.message);
      },
    })
  );
};
