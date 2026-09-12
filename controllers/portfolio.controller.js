import portfolioService from "../services/portfolio.service.js";
import { getClientIp } from "../utils/geo.util.js";

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
  }

  // POST /api/portfolio/create
  async createPortfolio(req, res) {
    try {
      const { name, description, templateId, siteData, saveMode } = req.body;
      const userId = req.user.id;

      const portfolio = await portfolioService.createPortfolio({
        userId,
        saveMode,
        name,
        description,
        templateId,
        siteData,
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
      });
    }
  }

  // POST /api/portfolio/track/:portfolioId
  async trackPortfolioView(req, res) {
    const { portfolioId } = req.params;
    const { referrer, path } = req.body || {};
    const ip = getClientIp(req);

    await portfolioService.trackView({
      portfolioId,
      referrer,
      path,
      ip,
    });

    res.status(204).end();
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
}

export const portfolioController = new PortfolioController();
export default portfolioController;