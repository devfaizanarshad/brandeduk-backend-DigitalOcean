const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');
const { checkDatabaseHealth, closePool } = require('./config/database');
require('dotenv').config();

const productsRoutes = require('./routes/products');
const categoriesRoutes = require('./routes/categories');
const filtersRoutes = require('./routes/filters');
const quotesRoutes = require('./routes/quotes');
const pricingRoutes = require('./routes/pricing');
const contactRoutes = require('./routes/contact');
const displayOrderRoutes = require('./routes/displayOrder');
const adminRoutes = require('./routes/admin');

// Load Swagger documentation
const swaggerDocument = YAML.load(path.join(__dirname, 'swagger.yaml'));

const app = express();
const PORT = process.env.PORT || 3004;

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  optionsSuccessStatus: 200,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  req.setTimeout(30000, () => {
    if (!res.headersSent) {
      res.status(408).json({ error: 'Request timeout' });
    }
  });
  next();
});

app.use((req, res, next) => {
  const startTime = Date.now();
  const originalSend = res.send;

  res.send = function (data) {
    const duration = Date.now() - startTime;
    console.log(`[HTTP] ${req.method} ${req.path} ${duration}ms`);
    return originalSend.call(this, data);
  };

  next();
});

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 100;

app.use('/api/', (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  if (rateLimitMap.size > 10000) {
    for (const [key, value] of rateLimitMap.entries()) {
      if (now - value.firstRequest > RATE_LIMIT_WINDOW) {
        rateLimitMap.delete(key);
      }
    }
  }

  const clientData = rateLimitMap.get(ip) || { count: 0, firstRequest: now };

  if (now - clientData.firstRequest > RATE_LIMIT_WINDOW) {
    clientData.count = 1;
    clientData.firstRequest = now;
  } else {
    clientData.count++;
  }

  rateLimitMap.set(ip, clientData);

  if (clientData.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: 'Too many requests',
      message: `Rate limit exceeded. Maximum ${RATE_LIMIT_MAX} requests per minute.`,
      retryAfter: Math.ceil((RATE_LIMIT_WINDOW - (now - clientData.firstRequest)) / 1000),
    });
  }

  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT_MAX - clientData.count));
  next();
});

app.use('/api/products', productsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/filters', filtersRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/display-order', displayOrderRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/admin', adminRoutes);

// Swagger API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .wrapper { max-width: 100%; padding: 0 20px; }
    html, body { margin: 0; padding: 0; }
  `,
  customSiteTitle: 'Branded UK API Documentation'
}));

// Redirect root to API docs
app.get('/', (req, res) => {
  res.redirect('/api-docs');
});

app.get('/health', async (req, res) => {
  const dbHealth = await checkDatabaseHealth();

  res.json({
    status: dbHealth.healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
    },
    database: dbHealth,
  });
});

app.get('/health/live', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

app.get('/health/ready', async (req, res) => {
  const dbHealth = await checkDatabaseHealth();
  if (dbHealth.healthy) {
    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({ status: 'not ready', database: dbHealth });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.path });
});

app.use((err, req, res, next) => {
  console.error('[ERROR] Unhandled error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  const isDevelopment = process.env.NODE_ENV !== 'production';

  res.status(err.status || 500).json({
    error: 'Internal server error',
    message: isDevelopment ? err.message : 'An error occurred',
    ...(isDevelopment && { stack: err.stack }),
  });
});

let server;

const gracefulShutdown = async (signal) => {
  console.log(`[SHUTDOWN] ${signal} received - initiating graceful shutdown`);

  if (server) {
    server.close(async () => {
      console.log('[SHUTDOWN] HTTP server closed');
      await closePool();
      console.log('[SHUTDOWN] Graceful shutdown complete');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('[SHUTDOWN] Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  } else {
    await closePool();
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  console.error('[ERROR] Uncaught exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled rejection:', { promise, reason });
});

server = app.listen(PORT, () => {
  console.log(`[SERVER] Started on port ${PORT}`);
  console.log(`[SERVER] API: http://localhost:${PORT}/api/products`);
  console.log(`[SERVER] Health: http://localhost:${PORT}/health`);
  console.log(`[SERVER] Environment: ${process.env.NODE_ENV || 'development'}`);
});

server.on('error', (error) => {

  if (error.code === 'EADDRINUSE') {
    console.error(`[SERVER] Port ${PORT} is already in use`);
  } else {
    console.error('[SERVER] Error:', error.message);
  }
  process.exit(1);
});

