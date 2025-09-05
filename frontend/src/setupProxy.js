const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Proxy API requests
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:8093',
      changeOrigin: true,
      ws: false, // Disable WebSocket proxy for API routes
      logLevel: 'debug',
      onError: (err, req, res) => {
        console.error('API Proxy error:', err);
        if (res && typeof res.writeHead === 'function') {
          res.writeHead(500, {
            'Content-Type': 'application/json',
          });
          res.end(JSON.stringify({ error: 'API Proxy Error', details: err.message }));
        }
      },
    })
  );

  // Proxy WebSocket connections for logs
  app.use(
    '/ws',
    createProxyMiddleware({
      target: 'http://localhost:8093',
      changeOrigin: true,
      ws: true,
      logLevel: 'debug',
      onError: (err, req, res) => {
        console.error('WebSocket Proxy error:', err);
      },
      onProxyReqWs: (proxyReq, req, socket, options, head) => {
        console.log('Proxying WebSocket connection to:', req.url);
      },
    })
  );

  // WebSocket upgrade handling for log streaming
  app.use(
    '/api/v1/logs/ws',
    createProxyMiddleware({
      target: 'ws://localhost:8093',
      ws: true,
      changeOrigin: true,
      logLevel: 'debug',
      onError: (err, req, res) => {
        console.error('WebSocket proxy error:', err);
      },
    })
  );
};
