import deployService from '../services/deploy.service.js';
import vercelService from '../services/vercel.service.js';
import netlifyService from '../services/netlify.service.js';
import {
  DEPLOY_STATE_COOKIE_NAME,
  createOAuthStateToken,
  verifyOAuthStateToken,
  createStateCookieOptions,
  createPopupCompleteUrl,
} from '../utils/Deployoauth.js';
import { slugifyProjectName } from '../utils/string.util.js';

export const NAME_PATTERN = /^[a-z0-9-]{1,63}$/;

// Controller handling deployment authorization, deployment triggers, SSE logs, and name checks
export class DeployController {
  constructor() {
    this.getDeployStatus = this.getDeployStatus.bind(this);
    this.authorizeVercel = this.authorizeVercel.bind(this);
    this.authorizeNetlify = this.authorizeNetlify.bind(this);
    this.vercelCallback = this.vercelCallback.bind(this);
    this.netlifyCallback = this.netlifyCallback.bind(this);
    this.deployToVercel = this.deployToVercel.bind(this);
    this.streamVercelDeployStatus = this.streamVercelDeployStatus.bind(this);
    this.deployToNetlify = this.deployToNetlify.bind(this);
    this.streamNetlifyDeployStatus = this.streamNetlifyDeployStatus.bind(this);
    this.checkNameAvailability = this.checkNameAvailability.bind(this);
    this.debugCredential = this.debugCredential.bind(this);
  }

  // GET /api/deploy/status
  async getDeployStatus(req, res, next) {
    try {
      const status = await deployService.getUserDeployStatus(req.user.id);
      res.status(200).json(status);
    } catch (err) {
      next(err);
    }
  }

  // GET /api/deploy/debug-credential
  async debugCredential(req, res, next) {
    try {
      const credential = await deployService.getUserDeployCredential(req.user.id, 'vercel');
      console.log('vercel credential:', credential);
      res.json(credential);
    } catch (err) {
      next(err);
    }
  }

  // GET /api/deploy/vercel/authorize
  async authorizeVercel(req, res, next) {
    try {
      const state = createOAuthStateToken(req.user.id, 'vercel');
      res.cookie(DEPLOY_STATE_COOKIE_NAME, state, createStateCookieOptions());

      const authUrl = vercelService.createVercelAuthorizationUrl(state);
      res.status(200).json({ authUrl });
    } catch (err) {
      next(err);
    }
  }

  // GET /api/deploy/netlify/authorize
  async authorizeNetlify(req, res, next) {
    try {
      const state = createOAuthStateToken(req.user.id, 'netlify');
      res.cookie(DEPLOY_STATE_COOKIE_NAME, state, createStateCookieOptions());

      const authUrl = netlifyService.createNetlifyAuthorizationUrl(state);
      res.status(200).json({ authUrl });
    } catch (err) {
      next(err);
    }
  }

  // GET /api/deploy/vercel/callback
  async vercelCallback(req, res) {
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

      const stateToken = req.cookies?.[DEPLOY_STATE_COOKIE_NAME] || req.query?.state;
      const statePayload = verifyOAuthStateToken(stateToken, 'vercel');
      res.clearCookie(DEPLOY_STATE_COOKIE_NAME, { path: '/api/deploy' });

      if (!statePayload) {
        return res.redirect(createPopupCompleteUrl('error', 'vercel', 'invalid_or_expired_state'));
      }

      const accessToken = await vercelService.exchangeVercelAuthorizationCode(code);
      await deployService.saveDeployCredential(statePayload.userId, 'vercel', accessToken, teamId || null);

      res.redirect(createPopupCompleteUrl('success', 'vercel'));
    } catch (err) {
      console.error('[deploy.controller] vercel callback failed:', err);
      res.redirect(createPopupCompleteUrl('error', 'vercel', 'server_error'));
    }
  }

  // GET /api/deploy/netlify/callback
  async netlifyCallback(req, res) {
    const { code, error: providerError, error_description: providerErrorDescription } = req.query;

    try {
      if (providerError) {
        const message = providerErrorDescription || providerError;
        return res.redirect(createPopupCompleteUrl('error', 'netlify', String(message)));
      }
      if (!code) {
        return res.redirect(createPopupCompleteUrl('error', 'netlify', 'missing_code'));
      }

      const stateToken = req.cookies?.[DEPLOY_STATE_COOKIE_NAME] || req.query?.state;
      const statePayload = verifyOAuthStateToken(stateToken, 'netlify');
      res.clearCookie(DEPLOY_STATE_COOKIE_NAME, { path: '/api/deploy' });

      if (!statePayload) {
        return res.redirect(createPopupCompleteUrl('error', 'netlify', 'invalid_or_expired_state'));
      }

      const accessToken = await netlifyService.exchangeNetlifyAuthorizationCode(code);
      await deployService.saveDeployCredential(statePayload.userId, 'netlify', accessToken);

      res.redirect(createPopupCompleteUrl('success', 'netlify'));
    } catch (err) {
      console.error('[deploy.controller] netlify callback failed:', err);
      res.redirect(createPopupCompleteUrl('error', 'netlify', 'server_error'));
    }
  }

  // POST /api/deploy/vercel/deploy
  async deployToVercel(req, res) {
    try {
      const { files, projectName, PortfolioID } = req.body;
      if (!files || typeof files !== 'object') return res.status(400).json({ error: 'Missing files' });

      const credential = await deployService.getUserDeployCredential(req.user.id, 'vercel');
      if (!credential) return res.status(400).json({ error: 'Vercel not connected' });

      const safeName = slugifyProjectName(projectName || `portfolio-${req.user.id.slice(0, 8)}`);
      const result = await vercelService.deployReactProjectToVercel(credential.access_token, safeName, files, credential.team_id, PortfolioID);
      res.status(200).json(result);
    } catch (err) {
      console.error('[deploy.controller] vercel deploy failed:', err);
      res.status(500).json({ error: err.message || 'Deployment failed' });
    }
  }

  // GET /api/deploy/vercel/deploy/:deploymentId/stream
  async streamVercelDeployStatus(req, res) {
    const { deploymentId } = req.params;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (line) => res.write(`data: ${JSON.stringify({ line })}\n\n`);

    try {
      const credential = await deployService.getUserDeployCredential(req.user.id, 'vercel');
      if (!credential) {
        send('Error: Vercel not connected');
        return res.end();
      }

      let lastState = null;
      const interval = setInterval(async () => {
        try {
          const state = await vercelService.getVercelDeploymentStatus(
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

  // POST /api/deploy/netlify/deploy
  async deployToNetlify(req, res) {
    try {
      const { html, projectName } = req.body;
      if (!html) return res.status(400).json({ error: 'Missing html content' });

      const credential = await deployService.getUserDeployCredential(req.user.id, 'netlify');
      if (!credential) return res.status(400).json({ error: 'Netlify not connected' });

      const result = await netlifyService.deployHtmlToNetlify(
        credential.access_token,
        projectName || `portfolio-${req.user.id.slice(0, 8)}`,
        html,
      );
      res.status(200).json(result);
    } catch (err) {
      console.error('[deploy.controller] netlify deploy failed:', err);
      res.status(500).json({ error: err.message || 'Deployment failed' });
    }
  }

  // GET /api/deploy/netlify/deploy/:siteId/:deployId/stream
  async streamNetlifyDeployStatus(req, res) {
    const { siteId, deployId } = req.params;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (line) => res.write(`data: ${JSON.stringify({ line })}\n\n`);

    try {
      const credential = await deployService.getUserDeployCredential(req.user.id, 'netlify');
      if (!credential) {
        send('Error: Netlify not connected');
        return res.end();
      }

      let lastState = null;
      const interval = setInterval(async () => {
        try {
          const state = await netlifyService.getNetlifyDeployStatus(credential.access_token, siteId, deployId);
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

  // GET /api/deploy/:platform/check-name
  async checkNameAvailability(req, res) {
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
        available = await deployService.checkVercelNameAvailable(userId, name);
      } else if (platform === "netlify") {
        available = await deployService.checkNetlifyNameAvailable(userId, name);
      } else {
        return res.status(400).json({ error: "Unknown platform" });
      }

      const url = platform === "vercel" ? `${name}.vercel.app` : `${name}.netlify.app`;

      let suggestions = [];
      if (!available) {
        const candidates = [`${name}-1`, `${name}-2`, `${name}-portfolio`, `${name}-dev`];
        for (const candidate of candidates) {
          const isFree = platform === "vercel"
            ? await deployService.checkVercelNameAvailable(userId, candidate)
            : await deployService.checkNetlifyNameAvailable(userId, candidate);
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
}

export const deployController = new DeployController();
export default deployController;