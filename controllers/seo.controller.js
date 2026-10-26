import seoService from "../services/seo.service.js";
import googleSearchConsoleService from "../services/googleSearchConsole.service.js";
import { createPopupCompleteUrl } from "../utils/Deployoauth.js";

/**
 * Clean & simple SEO Controller
 */
export class SeoController {
  // 1. GET /api/seo/:portfolioId
  async getSeo(req, res) {
    try {
      const { portfolioId } = req.params;
      const data = await seoService.getSeo(portfolioId, req.user?.id);
      return res.status(200).json({ success: true, seo: data });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  }

  // 2. PUT /api/seo/:portfolioId
  async updateSeo(req, res) {
    try {
      const { portfolioId } = req.params;
      const { title, description, keywords, googleVerificationCode } = req.body;

      const data = await seoService.updateSeo(portfolioId, req.user?.id, {
        title,
        description,
        keywords,
        googleVerificationCode,
      });

      return res.status(200).json({ success: true, message: "SEO settings saved successfully", seo: data });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  }

  // 3. GET /api/seo/:portfolioId/google/authorize
  async getGoogleAuthUrl(req, res) {
    try {
      const { portfolioId } = req.params;
      const authUrl = googleSearchConsoleService.getAuthorizationUrl(req.user.id, portfolioId);
      return res.status(200).json({ success: true, authUrl });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // 4. GET /api/seo/google/callback (Google redirects here after login)
  async googleCallback(req, res) {
    const { code, state, error: oauthError } = req.query;

    if (oauthError || !code) {
      return res.redirect(createPopupCompleteUrl("error", "google", oauthError || "missing_code"));
    }

    try {
      const statePayload = googleSearchConsoleService.verifyStateToken(state);
      if (!statePayload) {
        return res.redirect(createPopupCompleteUrl("error", "google", "invalid_state"));
      }

      // Exchange code for tokens & user email
      const { tokens, profile } = await googleSearchConsoleService.exchangeCodeForTokens(code);

      // Save tokens
      await seoService.saveGoogleConnection(statePayload.portfolioId, statePayload.userId, {
        tokens,
        profile,
      });

      // Redirect popup to completion page
      return res.redirect(createPopupCompleteUrl("success", "google"));
    } catch (err) {
      console.error("[googleCallback error]:", err.message);
      return res.redirect(createPopupCompleteUrl("error", "google", err.message));
    }
  }

  // 5. POST /api/seo/:portfolioId/google/disconnect
  async disconnectGoogle(req, res) {
    try {
      const { portfolioId } = req.params;
      const data = await seoService.disconnectGoogle(portfolioId, req.user?.id);
      return res.status(200).json({ success: true, message: "Google disconnected", seo: data });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  }

  // 6. POST /api/seo/:portfolioId/google/verify
  async verifyOwnership(req, res) {
    try {
      const { portfolioId } = req.params;
      const result = await seoService.verifyOwnership(portfolioId, req.user?.id);
      return res.status(200).json({ success: true, ...result });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  }

  // 7. POST /api/seo/:portfolioId/google/submit-sitemap
  async submitSitemap(req, res) {
    try {
      const { portfolioId } = req.params;
      const { sitemapUrl } = req.body || {};
      const result = await seoService.submitSitemap(portfolioId, req.user?.id, sitemapUrl);
      return res.status(200).json({ success: true, ...result });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  }

  // 8. POST /api/seo/:portfolioId/google/check-sitemap
  async checkSitemap(req, res) {
    try {
      const { portfolioId } = req.params;
      const { sitemapUrl } = req.body || {};
      const result = await seoService.checkSitemap(portfolioId, req.user?.id, sitemapUrl);
      return res.status(200).json({ success: true, ...result });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  }

  // 9. POST /api/seo/:portfolioId/google/inspect
  async inspectUrl(req, res) {
    try {
      const { portfolioId } = req.params;
      const { inspectionUrl } = req.body || {};
      const result = await seoService.inspectUrl(portfolioId, req.user?.id, inspectionUrl);
      if (result.success === false) {
        return res.status(200).json({ success: false, error: result.error, ...result });
      }
      return res.status(200).json({ success: true, ...result });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  }
}

export const seoController = new SeoController();
export default seoController;