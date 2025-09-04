const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:8093', // Backend server URL
      changeOrigin: true,
      ws: true, // Enable WebSocket proxy
      // Don't rewrite the path - keep /api prefix
      onError: (err, req, res) => {
        console.error('Proxy error:', err);
        if (res && typeof res.writeHead === 'function') {
          res.writeHead(500, {
            'Content-Type': 'application/json',
          });
          res.end(JSON.stringify({ error: 'Proxy Error', details: err.message }));
        }
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
