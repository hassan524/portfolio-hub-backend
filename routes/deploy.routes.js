import express from 'express';
import requireAuth from '../middlewares/auth.js';
import {
  getDeployStatus,
  authorizeVercel,
  authorizeNetlify,
  vercelCallback,
  netlifyCallback,
  deployToVercel,
  streamVercelDeployStatus,
  deployToNetlify,
  streamNetlifyDeployStatus,
  checkNameAvailability
} from '../controllers/deploy.controller.js';
import { getUserDeployCredential } from '../services/deploy.service.js';

const router = express.Router();

router.get('/status', requireAuth, getDeployStatus);

router.get('/debug-credential', requireAuth, async (req, res) => {
  const credential = await getUserDeployCredential(req.user.id, 'vercel');
  console.log('vercel credential:', credential);
  res.json(credential);
});

router.get('/vercel/authorize', requireAuth, authorizeVercel);
router.get('/netlify/authorize', requireAuth, authorizeNetlify);

router.get('/vercel/callback', vercelCallback);
router.get('/netlify/callback', netlifyCallback);

router.get("/:platform/check-name", requireAuth, checkNameAvailability);

router.post('/vercel/deploy', requireAuth, deployToVercel);
router.get('/vercel/deploy/:deploymentId/stream', requireAuth, streamVercelDeployStatus);

router.post('/netlify/deploy', requireAuth, deployToNetlify);
router.get('/netlify/deploy/:siteId/:deployId/stream', requireAuth, streamNetlifyDeployStatus);

export default router;