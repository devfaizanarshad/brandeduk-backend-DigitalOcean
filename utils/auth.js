const crypto = require('crypto');
const { queryWithTimeout } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'brandeduk-development-secret';
const JWT_EXPIRES_SECONDS = parseInt(process.env.JWT_EXPIRES_SECONDS || '604800', 10);

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET && !process.env.SESSION_SECRET) {
  throw new Error('JWT_SECRET or SESSION_SECRET is required in production');
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function parseBase64Url(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function signJwt(payload, expiresInSeconds = JWT_EXPIRES_SECONDS) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(body))}`;
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(unsigned)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${unsigned}.${signature}`;
}

function verifyJwt(token) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(unsigned)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(parseBase64Url(encodedPayload));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 120000;
  const digest = 'sha256';
  const hash = crypto.pbkdf2Sync(String(password), salt, iterations, 32, digest).toString('hex');
  return `pbkdf2$${digest}$${iterations}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;

  const [scheme, digest, iterationsRaw, salt, hash] = storedHash.split('$');
  if (scheme !== 'pbkdf2' || !digest || !iterationsRaw || !salt || !hash) return false;

  const iterations = parseInt(iterationsRaw, 10);
  const candidate = crypto.pbkdf2Sync(String(password), salt, iterations, 32, digest).toString('hex');
  const candidateBuffer = Buffer.from(candidate, 'hex');
  const hashBuffer = Buffer.from(hash, 'hex');
  return candidateBuffer.length === hashBuffer.length && crypto.timingSafeEqual(candidateBuffer, hashBuffer);
}

function getBearerToken(req) {
  const authHeader = req.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function loadAuthUser(userId) {
  const result = await queryWithTimeout(`
    SELECT id, name, email, google_id, avatar, provider, role, created_at, updated_at
    FROM customer_users
    WHERE id = $1
    LIMIT 1
  `, [userId], 10000);

  return result.rows[0] || null;
}

async function optionalAuth(req, res, next) {
  try {
    const token = getBearerToken(req);
    const payload = verifyJwt(token);
    if (payload?.sub) {
      req.user = await loadAuthUser(payload.sub);
    }
    next();
  } catch (error) {
    next(error);
  }
}

async function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);
    const payload = verifyJwt(token);
    if (!payload?.sub) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const user = await loadAuthUser(payload.sub);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid session' });
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  hashPassword,
  optionalAuth,
  requireAuth,
  signJwt,
  verifyJwt,
  verifyPassword,
};
