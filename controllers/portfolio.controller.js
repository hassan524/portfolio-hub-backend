// controllers/portfolio.controller.js

import { createPortfolioService } from "../services/portfolio.service.js";

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