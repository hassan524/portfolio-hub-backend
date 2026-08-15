import crypto from 'crypto';

const STATE_TOKEN_TTL_MS = 10 * 60 * 1000; 

export const DEPLOY_STATE_COOKIE_NAME = 'deploy_oauth_state';

function getStateSecret() {
  const secret = process.env.DEPLOY_OAUTH_STATE_SECRET;
  if (!secret) {
    throw new Error('DEPLOY_OAUTH_STATE_SECRET is not configured');
  }
  return secret;
}


export function createOAuthStateToken(userId, platform) {
  const payload = {
    userId,
    platform,
    nonce: crypto.randomBytes(16).toString('hex'),
    expiresAt: Date.now() + STATE_TOKEN_TTL_MS,
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getStateSecret())
    .update(payloadBase64)
    .digest('base64url');

  return `${payloadBase64}.${signature}`;
}


export function verifyOAuthStateToken(token, expectedPlatform) {
  if (!token || !token.includes('.')) {
    return null;
  }

  const [payloadBase64, signature] = token.split('.');

  const expectedSignature = crypto
    .createHmac('sha256', getStateSecret())
    .update(payloadBase64)
    .digest('base64url');

  const signatureIsValid =
    signature.length === expectedSignature.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

  if (!signatureIsValid) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const isExpired = !payload.expiresAt || Date.now() > payload.expiresAt;
  const isWrongPlatform = payload.platform !== expectedPlatform;

  if (!payload.userId || isExpired || isWrongPlatform) {
    return null;
  }

  return payload;
}


export function createStateCookieOptions() {
  return {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: STATE_TOKEN_TTL_MS,
    path: '/api/deploy',
  };
}

export function createPopupCompleteUrl(status, platform, message) {
  const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const url = new URL('/oauth-complete', frontendBaseUrl);
  url.searchParams.set('deploy_status', status);
  url.searchParams.set('platform', platform);
  if (message) url.searchParams.set('message', message);
  return url.toString();
}

export function createFrontendRedirectUrl(status, platform, message) {
  const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const redirectUrl = new URL('/dashboard', frontendBaseUrl);

  redirectUrl.searchParams.set('deploy_status', status); // 'success' | 'error'
  redirectUrl.searchParams.set('platform', platform); // 'vercel' | 'netlify'
  if (message) {
    redirectUrl.searchParams.set('message', message);
  }

  return redirectUrl.toString();
}