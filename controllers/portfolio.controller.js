import portfolioService from "../services/portfolio.service.js";
import { getClientIp, resolveCountry } from "../utils/geo.util.js";

// Controller for portfolio CRUD, view tracking, and analytics endpoints
export class PortfolioController {
  constructor() {
    this.createPortfolio = this.createPortfolio.bind(this);
    this.listPortfolios = this.listPortfolios.bind(this);
    this.trackPortfolioView = this.trackPortfolioView.bind(this);
    this.getPortfolioRangeViews = this.getPortfolioRangeViews.bind(this);
    this.getPortfolioViews30d = this.getPortfolioViews30d.bind(this);
    this.getPortfolioViewsTotal = this.getPortfolioViewsTotal.bind(this);
    this.getPortfolioDetail = this.getPortfolioDetail.bind(this);
    this.getPortfolioOverviewData = this.getPortfolioOverviewData.bind(this);
    this.getPortfolioTrafficData = this.getPortfolioTrafficData.bind(this);
    this.updatePortfolioSiteData = this.updatePortfolioSiteData.bind(this);
    this.redeployPortfolio = this.redeployPortfolio.bind(this);
    this.deletePortfolio = this.deletePortfolio.bind(this);
  }

  // POST /api/portfolio/create
  async createPortfolio(req, res) {
    try {
      const { finalWebsiteName, name, description, templateId, siteData, saveMode, liveUrl } = req.body;
      const userId = req.user.id;

      const portfolio = await portfolioService.createPortfolio({
        userId,
        saveMode,
        name: finalWebsiteName || name,
        description,
        templateId,
        siteData,
        liveUrl,
      });

      return res.status(201).json({
        success: true,
        message: "Portfolio created successfully",
        portfolio,
      });
    } catch (error) {
      console.error("Create portfolio error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create portfolio",
        error: error.message,
      });
    }
  }

  // GET /api/portfolio/list
  async listPortfolios(req, res) {
    try {
      const userId = req.user.id;
      const userPortfolios = await portfolioService.listUserPortfolios(userId);

      return res.status(200).json({
        success: true,
        message: "Portfolios fetched successfully",
        portfolios: userPortfolios,
      });
    } catch (error) {
      console.error("List portfolios error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to list portfolios",
        error: error.message,
      });
    }
  }

  // POST /api/portfolio/track/:portfolioId
  async trackPortfolioView(req, res) {
    try {
      const { portfolioId } = req.params;
      const { referrer, path, timeZone, country: clientCountry } = req.body || {};
      const userAgent = req.headers["user-agent"] || "";

      // Ignore automated bots, crawlers, and link preview generators
      if (/bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview|headless|lighthouse/i.test(userAgent)) {
        return res.status(204).end();
      }

      const ip = getClientIp(req);
      const country = resolveCountry({ req, ip, timeZone, countryHint: clientCountry });

      await portfolioService.trackView({
        portfolioId,
        referrer,
        path,
        ip,
        country,
      });

      return res.status(204).end();
    } catch (err) {
      console.error("[trackPortfolioView] controller error:", err);
      return res.status(204).end();
    }
  }

  // GET /api/portfolio/:portfolioId/viewsRange
  async getPortfolioRangeViews(req, res) {
    try {
      const { portfolioId } = req.params;
      const range = req.query.range || "7d";

      const data = await portfolioService.getPortfoliosTrafficViewsRange(portfolioId, range);
      res.json(data);
    } catch (err) {
      console.error("getPortfolioTraffic failed", err);
      res.status(500).json({ error: "Failed to load traffic data" });
    }
  }

  // GET /api/portfolio/:portfolioId/views-30d
  async getPortfolioViews30d(req, res) {
    try {
      const { portfolioId } = req.params;
      const count = await portfolioService.getPortfolioViews30d(portfolioId);
      res.json({ views30d: count });
    } catch (err) {
      console.error("getPortfolioViews30d failed", err);
      res.status(500).json({ error: "Failed to load views" });
    }
  }

  // GET /api/portfolio/:portfolioId/views-total
  async getPortfolioViewsTotal(req, res) {
    try {
      const { portfolioId } = req.params;
      const count = await portfolioService.getPortfolioTotalViews(portfolioId);
      res.json({ totalViews: count });
    } catch (err) {
      console.error("getPortfolioViewsTotal failed", err);
      res.status(500).json({ error: "Failed to load total views" });
    }
  }

  // GET /api/portfolio/:portfolioId
  async getPortfolioDetail(req, res) {
    try {
      const { portfolioId } = req.params;
      const portfolio = await portfolioService.getPortfolioById(portfolioId, req.user.id);

      if (!portfolio) {
        return res.status(404).json({ error: "Portfolio not found" });
      }

      res.json(portfolio);
    } catch (err) {
      console.error("getPortfolioDetail failed", err);
      res.status(500).json({ error: "Failed to load portfolio" });
    }
  }

  // GET /api/portfolio/:portfolioId/overview
  async getPortfolioOverviewData(req, res) {
    try {
      const { portfolioId } = req.params;
      const portfolioOverviewData = await portfolioService.getPortfolioOverview(portfolioId, req.user.id);

      if (!portfolioOverviewData) {
        return res.status(404).json({ error: "Portfolio overview not found" });
      }

      res.json(portfolioOverviewData);
    } catch (err) {
      console.error("getPortfolioOverviewData failed", err);
      res.status(500).json({ error: "Failed to load portfolio overview data" });
    }
  }

  // GET /api/portfolio/:portfolioId/traffic
  async getPortfolioTrafficData(req, res) {
    try {
      const { portfolioId } = req.params;
      const trafficData = await portfolioService.getPortfoliosTraffic(portfolioId);
      res.json(trafficData);
    } catch (err) {
      console.error("getPortfolioTrafficData failed", err);
      res.status(500).json({ error: "Failed to load portfolio traffic metrics" });
    }
  }

  // PUT /api/portfolio/:portfolioId/site-data
  async updatePortfolioSiteData(req, res) {
    try {
      const { portfolioId } = req.params;
      const { siteData, name, description } = req.body;
      const userId = req.user.id;

      const portfolio = await portfolioService.updatePortfolioSiteData(portfolioId, userId, {
        siteData,
        name,
        description,
      });

      return res.status(200).json({
        success: true,
        message: "Portfolio updated successfully",
        portfolio,
      });
    } catch (error) {
      console.error("Update portfolio error:", error);
      const status = error.status || 500;
      return res.status(status).json({
        success: false,
        message: error.message || "Failed to update portfolio",
        error: error.message,
      });
    }
  }

  // POST /api/portfolio/:portfolioId/redeploy
  async redeployPortfolio(req, res) {
    try {
      const { portfolioId } = req.params;
      const { files } = req.body;
      const userId = req.user.id;

      const result = await portfolioService.redeployPortfolio(portfolioId, userId, files);

      return res.status(200).json({
        success: true,
        message: "Portfolio redeployed successfully",
        ...result,
      });
    } catch (error) {
      console.error("Redeploy portfolio error:", error);
      const status = error.status || 500;
      return res.status(status).json({
        success: false,
        message: error.message || "Failed to redeploy portfolio",
        error: error.message,
      });
    }
  }

  // DELETE /api/portfolio/:portfolioId
  async deletePortfolio(req, res) {
    try {
      const { portfolioId } = req.params;
      const userId = req.user.id;

      const result = await portfolioService.deletePortfolio(portfolioId, userId);

      return res.status(200).json({
        success: true,
        message: "Project deleted successfully",
        ...result,
      });
    } catch (error) {
      console.error("Delete portfolio error:", error);
      const status = error.status || 500;
      return res.status(status).json({
        success: false,
        message: error.message || "Failed to delete project",
        error: error.message,
      });
    }
  }
}

export const portfolioController = new PortfolioController();
export default portfolioController;