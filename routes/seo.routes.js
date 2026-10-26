import express from "express";
import seoController from "../controllers/seo.controller.js";
import requireAuth from "../middlewares/auth.js";

const router = express.Router();

// 1. Google OAuth callback (Google sends user back here after login)
router.get("/google/callback", seoController.googleCallback);

// 2. Basic SEO settings (Title, Description, Keywords, Verification Code)
router.get("/:portfolioId", requireAuth, seoController.getSeo);
router.get("/:portfolioId/seo", requireAuth, seoController.getSeo);
router.put("/:portfolioId", requireAuth, seoController.updateSeo);

// 3. Google Search Console actions
router.get("/:portfolioId/google/authorize", requireAuth, seoController.getGoogleAuthUrl);
router.post("/:portfolioId/google/disconnect", requireAuth, seoController.disconnectGoogle);
router.post("/:portfolioId/google/verify", requireAuth, seoController.verifyOwnership);
router.post("/:portfolioId/google/submit-sitemap", requireAuth, seoController.submitSitemap);
router.post("/:portfolioId/google/check-sitemap", requireAuth, seoController.checkSitemap);
router.post("/:portfolioId/google/inspect", requireAuth, seoController.inspectUrl);

export default router;