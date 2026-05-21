const express = require('express');
const { signJwt, requireAuth } = require('../utils/auth');
const {
  loginUser,
  publicUser,
  registerUser,
  upsertGoogleUser,
} = require('../services/customerCheckoutService');

const router = express.Router();

function authResponse(user) {
  return {
    user,
    token: signJwt({ sub: user.id, email: user.email, role: user.role }),
  };
}

function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    const error = new Error('Google OAuth is not configured');
    error.status = 500;
    throw error;
  }

  return { clientId, clientSecret, redirectUri };
}

function redirectWithAuth(user, res) {
  const { token } = authResponse(user);
  const successUrl = process.env.FRONTEND_AUTH_SUCCESS_URL;

  if (!successUrl) {
    return res.json({ success: true, data: authResponse(user) });
  }

  const target = new URL(successUrl);
  target.searchParams.set('token', token);
  return res.redirect(target.toString());
}

async function exchangeGoogleCode(code) {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error_description || data.error || 'Google token exchange failed');
    error.status = 401;
    throw error;
  }

  return data;
}

async function verifyGoogleIdToken(idToken) {
  const { clientId } = getGoogleConfig();
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  const data = await response.json();

  if (!response.ok || data.aud !== clientId || data.email_verified !== 'true') {
    const error = new Error('Google identity could not be verified');
    error.status = 401;
    throw error;
  }

  return {
    googleId: data.sub,
    email: data.email,
    name: data.name || [data.given_name, data.family_name].filter(Boolean).join(' '),
    avatar: data.picture || null,
  };
}

router.get('/google', (req, res, next) => {
  try {
    const { clientId, redirectUri } = getGoogleConfig();
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'select_account');
    if (state) url.searchParams.set('state', state);
    res.redirect(url.toString());
  } catch (error) {
    next(error);
  }
});

router.get('/google/callback', async (req, res, next) => {
  try {
    if (req.query.error) {
      const error = new Error(String(req.query.error_description || req.query.error));
      error.status = 400;
      throw error;
    }

    const code = req.query.code;
    if (!code || typeof code !== 'string') {
      const error = new Error('Google code is required');
      error.status = 400;
      throw error;
    }

    const tokenData = await exchangeGoogleCode(code);
    const profile = await verifyGoogleIdToken(tokenData.id_token);
    const user = await upsertGoogleUser(profile);
    return redirectWithAuth(user, res);
  } catch (error) {
    const failureUrl = process.env.FRONTEND_AUTH_FAILURE_URL;
    if (failureUrl) {
      const target = new URL(failureUrl);
      target.searchParams.set('message', error.message);
      return res.redirect(target.toString());
    }
    return next(error);
  }
});

router.post('/register', async (req, res, next) => {
  try {
    const user = await registerUser(req.body || {});
    res.status(201).json({ success: true, data: authResponse(user) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'An account with this email already exists' });
    }
    return next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const user = await loginUser(req.body || {});
    res.json({ success: true, data: authResponse(user) });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out' });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ success: true, data: { user: publicUser(req.user) } });
});

module.exports = router;
