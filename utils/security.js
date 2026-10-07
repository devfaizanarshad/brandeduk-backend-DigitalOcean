const DEFAULT_PRODUCTION_ORIGINS = [
  'https://www.brandeduk.com',
  'https://brandeduk.com',
  'https://admin.brandeduk.com',
];

function getAllowedOrigins() {
  const configured = String(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin && origin !== '*');

  const defaults = process.env.NODE_ENV === 'production'
    ? DEFAULT_PRODUCTION_ORIGINS
    : [...DEFAULT_PRODUCTION_ORIGINS, 'http://localhost:5173', 'http://127.0.0.1:5173'];

  return new Set(configured.length > 0 ? configured : defaults);
}

function buildCorsOptions() {
  const allowedOrigins = getAllowedOrigins();
  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      const error = new Error('Origin not allowed');
      error.status = 403;
      return callback(error);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Cache-Control'],
    optionsSuccessStatus: 204,
  };
}

module.exports = { buildCorsOptions, getAllowedOrigins };
