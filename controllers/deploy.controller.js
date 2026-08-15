import { getUserDeployStatus, saveDeployCredential } from '../services/deploy.service.js';
import { createVercelAuthorizationUrl, exchangeVercelAuthorizationCode } from '../services/vercel.service.js';
import { createNetlifyAuthorizationUrl, exchangeNetlifyAuthorizationCode } from '../services/netlify.service.js';
import {
  DEPLOY_STATE_COOKIE_NAME,
  createOAuthStateToken,
  verifyOAuthStateToken,
  createStateCookieOptions,
  createFrontendRedirectUrl,
} from '../utils/Deployoauth.js';


export async function getDeployStatus(req, res, next) {
  try {
    const status = await getUserDeployStatus(req.user.id); 
    res.status(200).json(status);
  } catch (err) {
    next(err);
  }
}

export async function authorizeVercel(req, res, next) {
  try {
    const state = createOAuthStateToken(req.user.id, 'vercel');
    res.cookie(DEPLOY_STATE_COOKIE_NAME, state, createStateCookieOptions());

    const authUrl = createVercelAuthorizationUrl(state);
    res.status(200).json({ authUrl });
  } catch (err) {
    next(err);
  }
}

export async function authorizeNetlify(req, res, next) {
  try {
    const state = createOAuthStateToken(req.user.id, 'netlify');
    res.cookie(DEPLOY_STATE_COOKIE_NAME, state, createStateCookieOptions());

    const authUrl = createNetlifyAuthorizationUrl(state);
    res.status(200).json({ authUrl });
  } catch (err) {
    next(err);
  }
}

export async function vercelCallback(req, res) {
  const { code, error: providerError, error_description: providerErrorDescription } = req.query;

  try {
    if (providerError) {
      const message = providerErrorDescription || providerError;
      return res.redirect(createFrontendRedirectUrl('error', 'vercel', String(message)));
    }
    if (!code) {
      return res.redirect(createFrontendRedirectUrl('error', 'vercel', 'missing_code'));
    }

    const stateToken = req.cookies?.[DEPLOY_STATE_COOKIE_NAME];
    const statePayload = verifyOAuthStateToken(stateToken, 'vercel');
    res.clearCookie(DEPLOY_STATE_COOKIE_NAME, { path: '/api/deploy' });

    if (!statePayload) {
      return res.redirect(createFrontendRedirectUrl('error', 'vercel', 'invalid_or_expired_state'));
    }

    const accessToken = await exchangeVercelAuthorizationCode(code);
    await saveDeployCredential(statePayload.userId, 'vercel', accessToken);

    res.redirect(createFrontendRedirectUrl('success', 'vercel'));
  } catch (err) {
    console.error('[deploy.controller] vercel callback failed:', err);
    res.redirect(createFrontendRedirectUrl('error', 'vercel', 'server_error'));
  }
}

export async function netlifyCallback(req, res) {
  const { code, error: providerError, error_description: providerErrorDescription } = req.query;

  try {
    if (providerError) {
      const message = providerErrorDescription || providerError;
      return res.redirect(createFrontendRedirectUrl('error', 'netlify', String(message)));
    }
    if (!code) {
      return res.redirect(createFrontendRedirectUrl('error', 'netlify', 'missing_code'));
    }

    const stateToken = req.cookies?.[DEPLOY_STATE_COOKIE_NAME];
    const statePayload = verifyOAuthStateToken(stateToken, 'netlify');
    res.clearCookie(DEPLOY_STATE_COOKIE_NAME, { path: '/api/deploy' });

    if (!statePayload) {
      return res.redirect(createFrontendRedirectUrl('error', 'netlify', 'invalid_or_expired_state'));
    }

    const accessToken = await exchangeNetlifyAuthorizationCode(code);
    await saveDeployCredential(statePayload.userId, 'netlify', accessToken);

    res.redirect(createFrontendRedirectUrl('success', 'netlify'));
  } catch (err) {
    console.error('[deploy.controller] netlify callback failed:', err.message);
    res.redirect(createFrontendRedirectUrl('error', 'netlify', 'server_error'));
  }
}