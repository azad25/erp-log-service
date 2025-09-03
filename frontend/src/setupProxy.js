const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:8000', // Backend server URL
      changeOrigin: true,
      ws: true, // Enable WebSocket proxy
      pathRewrite: {
        '^/api': '', // Remove /api prefix when forwarding
      },
      onError: (err, req, res) => {
        console.error('Proxy error:', err);
        res.writeHead(500, {
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({ error: 'Proxy Error', details: err.message }));
      },
    })
  );

  // WebSocket upgrade handling
  app.use(
    '/ws',
    createProxyMiddleware({
      target: 'ws://localhost:8000',
      ws: true,
      changeOrigin: true,
      logLevel: 'debug',
    })
  );
};
