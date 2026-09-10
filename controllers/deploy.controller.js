import {
  getUserDeployStatus,
  saveDeployCredential,
  getUserDeployCredential,
  checkVercelNameAvailable,
  checkNetlifyNameAvailable
} from '../services/deploy.service.js';
import {
  createVercelAuthorizationUrl,
  exchangeVercelAuthorizationCode,
  deployReactProjectToVercel,
  getVercelDeploymentStatus,
  slugifyProjectName,
} from '../services/vercel.service.js';
import {
  createNetlifyAuthorizationUrl,
  exchangeNetlifyAuthorizationCode,
  deployHtmlToNetlify,
  getNetlifyDeployStatus,
} from '../services/netlify.service.js';
import {
  DEPLOY_STATE_COOKIE_NAME,
  createOAuthStateToken,
  verifyOAuthStateToken,
  createStateCookieOptions,
  createPopupCompleteUrl,
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
  const {
    code,
    teamId,
    error: providerError,
    error_description: providerErrorDescription,
  } = req.query;

  try {
    if (providerError) {
      const message = providerErrorDescription || providerError;
      return res.redirect(createPopupCompleteUrl('error', 'vercel', String(message)));
    }
    if (!code) {
      return res.redirect(createPopupCompleteUrl('error', 'vercel', 'missing_code'));
    }

    const stateToken = req.cookies?.[DEPLOY_STATE_COOKIE_NAME];
    const statePayload = verifyOAuthStateToken(stateToken, 'vercel');
    res.clearCookie(DEPLOY_STATE_COOKIE_NAME, { path: '/api/deploy' });

    if (!statePayload) {
      return res.redirect(createPopupCompleteUrl('error', 'vercel', 'invalid_or_expired_state'));
    }

    const accessToken = await exchangeVercelAuthorizationCode(code);
    await saveDeployCredential(statePayload.userId, 'vercel', accessToken, teamId || null);

    res.redirect(createPopupCompleteUrl('success', 'vercel'));
  } catch (err) {
    console.error('[deploy.controller] vercel callback failed:', err);
    res.redirect(createPopupCompleteUrl('error', 'vercel', 'server_error'));
  }
}

export async function netlifyCallback(req, res) {
  const { code, error: providerError, error_description: providerErrorDescription } = req.query;

  try {
    if (providerError) {
      const message = providerErrorDescription || providerError;
      return res.redirect(createPopupCompleteUrl('error', 'netlify', String(message)));
    }
    if (!code) {
      return res.redirect(createPopupCompleteUrl('error', 'netlify', 'missing_code'));
    }

    const stateToken = req.cookies?.[DEPLOY_STATE_COOKIE_NAME];
    const statePayload = verifyOAuthStateToken(stateToken, 'netlify');
    res.clearCookie(DEPLOY_STATE_COOKIE_NAME, { path: '/api/deploy' });

    if (!statePayload) {
      return res.redirect(createPopupCompleteUrl('error', 'netlify', 'invalid_or_expired_state'));
    }

    const accessToken = await exchangeNetlifyAuthorizationCode(code);
    await saveDeployCredential(statePayload.userId, 'netlify', accessToken);

    res.redirect(createPopupCompleteUrl('success', 'netlify'));
  } catch (err) {
    console.error('[deploy.controller] netlify callback failed:', err);
    res.redirect(createPopupCompleteUrl('error', 'netlify', 'server_error'));
  }
}

export async function deployToVercel(req, res) {
  try {
    const { files, projectName, PortfolioID } = req.body; 
    if (!files || typeof files !== 'object') return res.status(400).json({ error: 'Missing files' });

    const credential = await getUserDeployCredential(req.user.id, 'vercel');
    if (!credential) return res.status(400).json({ error: 'Vercel not connected' });

    const safeName = slugifyProjectName(projectName || `portfolio-${req.user.id.slice(0, 8)}`);
    console.log("project name:", projectName, "safeName:", safeName);
    const result = await deployReactProjectToVercel(credential.access_token, safeName, files, credential.team_id, PortfolioID);
    res.status(200).json(result);
  } catch (err) {
    console.error('[deploy.controller] vercel deploy failed:', err);
    res.status(500).json({ error: err.message || 'Deployment failed' });
  }
}

export async function streamVercelDeployStatus(req, res) {
  const { deploymentId } = req.params;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (line) => res.write(`data: ${JSON.stringify({ line })}\n\n`);

  try {
    const credential = await getUserDeployCredential(req.user.id, 'vercel');
    if (!credential) {
      send('Error: Vercel not connected');
      return res.end();
    }

    let lastState = null;
    const interval = setInterval(async () => {
      try {
        const state = await getVercelDeploymentStatus(
          credential.access_token,
          deploymentId,
          credential.team_id,
        );
        if (state !== lastState) {
          send(`Status: ${state}`);
          lastState = state;
        }
        if (state === 'READY' || state === 'ERROR' || state === 'CANCELED') {
          clearInterval(interval);
          res.end();
        }
      } catch (err) {
        send(`Error: ${err.message}`);
        clearInterval(interval);
        res.end();
      }
    }, 1200);

    req.on('close', () => clearInterval(interval));
  } catch (err) {
    send(`Error: ${err.message}`);
    res.end();
  }
}

export async function deployToNetlify(req, res) {
  try {
    const { html, projectName } = req.body;
    if (!html) return res.status(400).json({ error: 'Missing html content' });

    const credential = await getUserDeployCredential(req.user.id, 'netlify');
    if (!credential) return res.status(400).json({ error: 'Netlify not connected' });

    const result = await deployHtmlToNetlify(
      credential.access_token,
      projectName || `portfolio-${req.user.id.slice(0, 8)}`,
      html,
    );
    res.status(200).json(result); // { siteId, deployId, url }
  } catch (err) {
    console.error('[deploy.controller] netlify deploy failed:', err);
    res.status(500).json({ error: err.message || 'Deployment failed' });
  }
}

export async function streamNetlifyDeployStatus(req, res) {
  const { siteId, deployId } = req.params;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (line) => res.write(`data: ${JSON.stringify({ line })}\n\n`);

  try {
    const credential = await getUserDeployCredential(req.user.id, 'netlify');
    if (!credential) {
      send('Error: Netlify not connected');
      return res.end();
    }

    let lastState = null;
    const interval = setInterval(async () => {
      try {
        const state = await getNetlifyDeployStatus(credential.access_token, siteId, deployId);
        if (state !== lastState) {
          send(`Status: ${state}`);
          lastState = state;
        }
        if (state === 'ready' || state === 'error') {
          clearInterval(interval);
          res.end();
        }
      } catch (err) {
        send(`Error: ${err.message}`);
        clearInterval(interval);
        res.end();
      }
    }, 1200);

    req.on('close', () => clearInterval(interval));
  } catch (err) {
    send(`Error: ${err.message}`);
    res.end();
  }
}

export const NAME_PATTERN = /^[a-z0-9-]{1,63}$/;

export async function checkNameAvailability(req, res) {
  const platform = req.params.platform;
  const name = String(req.query.name || "").trim().toLowerCase();
  const userId = req.user.id;

  res.set('Cache-Control', 'no-store');

  if (!name || !NAME_PATTERN.test(name)) {
    return res.status(400).json({ error: "Invalid name" });
  }

  try {
    let available;
    if (platform === "vercel") {
      available = await checkVercelNameAvailable(userId, name);
    } else if (platform === "netlify") {
      available = await checkNetlifyNameAvailable(userId, name);
    } else {
      return res.status(400).json({ error: "Unknown platform" });
    }

    const url = platform === "vercel" ? `${name}.vercel.app` : `${name}.netlify.app`;

    let suggestions = [];
    if (!available) {
      const candidates = [`${name}-1`, `${name}-2`, `${name}-portfolio`, `${name}-dev`];
      for (const candidate of candidates) {
        const isFree = platform === "vercel"
          ? await checkVercelNameAvailable(userId, candidate)
          : await checkNetlifyNameAvailable(userId, candidate);
        if (isFree) suggestions.push(candidate);
        if (suggestions.length === 3) break;
      }
    }

    res.json({ available, url, suggestions });
  } catch (err) {
    console.error("checkNameAvailability error:", err);
    res.status(502).json({ error: "Couldn't reach hosting provider" });
  }
}