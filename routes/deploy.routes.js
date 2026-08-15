import express from 'express';

import requireAuth from '../middlewares/auth.js';

import {
  getDeployStatus,
  authorizeVercel,
  authorizeNetlify,
  vercelCallback,
  netlifyCallback,
} from '../controllers/deploy.controller.js';

const router = express.Router();

router.get('/status', requireAuth, getDeployStatus);
router.get('/vercel/authorize', requireAuth, authorizeVercel);
router.get('/netlify/authorize', requireAuth, authorizeNetlify);

router.get('/vercel/callback', vercelCallback);
router.get('/netlify/callback', netlifyCallback);

export default router;