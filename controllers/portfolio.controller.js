// controllers/portfolio.controller.js

import { createPortfolioService, listUserPortfolios, getPortfoliosTraffic, getPortfolioById, getPortfolioViews30d as getViews30dCount, getPortfolioTotalViews  } from "../services/portfolio.service.js";

export const createPortfolio = async (req, res) => {
    try {
        const { name, description, templateId, siteData, saveMode } = req.body;
        const userId = req.user.id;

        const portfolio = await createPortfolioService({
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
};

export const listPortfolios = async (req, res) => {
    try {

        const userId = req.user.id;
        const userPortfolios = await listUserPortfolios(userId)

        return res.status(201).json({
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

export const trackPortfolioView = async (req, res) => {
  await supabase
    .from("portfolio_views")
    .insert({ portfolio_id: req.params.portfolioId });

  res.status(204).end();
};

export const getPortfolioTraffic = async (req, res) => {
  try {
    const { portfolioId } = req.params;
    const range = req.query.range || "7d";

    const data = await getPortfoliosTraffic(portfolioId, range);
    res.json(data);
  } catch (err) {
    console.error("getPortfolioTraffic failed", err);
    res.status(500).json({ error: "Failed to load traffic data" });
  }
};


export const getPortfolioViews30d = async (req, res) => {
  try {
    const { portfolioId } = req.params;
    const count = await getViews30dCount(portfolioId);
    res.json({ views30d: count });
  } catch (err) {
    console.error("getPortfolioViews30d failed", err);
    res.status(500).json({ error: "Failed to load views" });
  }
};

export const getPortfolioViewsTotal = async (req, res) => {
  try {
    const { portfolioId } = req.params;
    const count = await getPortfolioTotalViews(portfolioId);
    res.json({ totalViews: count });
  } catch (err) {
    console.error("getPortfolioViewsTotal failed", err);
    res.status(500).json({ error: "Failed to load total views" });
  }
};



export const getPortfolioDetail = async (req, res) => {
  try {
    const { portfolioId } = req.params;

    const portfolio = await getPortfolioById(portfolioId, req.user.id);

    if (!portfolio) {
      return res.status(404).json({ error: "Portfolio not found" });
    }

    res.json(portfolio);
  } catch (err) {
    console.error("getPortfolioDetail failed", err);
    res.status(500).json({ error: "Failed to load portfolio" });
  }
};