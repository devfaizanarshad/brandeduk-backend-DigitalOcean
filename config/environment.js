require('dotenv').config();

const REQUIRED_PRODUCTION_VARIABLES = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'JWT_SECRET',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'EMAIL_TO',
];

function validateEnvironment(environment = process.env) {
  if (environment.NODE_ENV !== 'production') return;

  const missing = REQUIRED_PRODUCTION_VARIABLES.filter((name) => !String(environment[name] || '').trim());
  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  }

  if (String(environment.JWT_SECRET).length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters');
  }
}

if (require.main === module) {
  validateEnvironment();
  console.log('Environment configuration is valid');
}

module.exports = { REQUIRED_PRODUCTION_VARIABLES, validateEnvironment };
