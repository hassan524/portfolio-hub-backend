import express from 'express';
import requireAuth from '../middlewares/auth.js';
import deployController from '../controllers/deploy.controller.js';

const router = express.Router();

router.get('/status', requireAuth, deployController.getDeployStatus);

router.get('/debug-credential', requireAuth, deployController.debugCredential);

router.get('/vercel/authorize', requireAuth, deployController.authorizeVercel);
router.get('/netlify/authorize', requireAuth, deployController.authorizeNetlify);

router.get('/vercel/callback', deployController.vercelCallback);
router.get('/netlify/callback', deployController.netlifyCallback);

router.get("/:platform/check-name", requireAuth, deployController.checkNameAvailability);

router.post('/vercel/deploy', requireAuth, deployController.deployToVercel);
router.get('/vercel/deploy/:deploymentId/stream', requireAuth, deployController.streamVercelDeployStatus);

router.post('/netlify/deploy', requireAuth, deployController.deployToNetlify);
router.get('/netlify/deploy/:siteId/:deployId/stream', requireAuth, deployController.streamNetlifyDeployStatus);

export default router;