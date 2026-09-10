import express from "express";
import requireAuth from "../middlewares/auth.js";
import { createPortfolio, listPortfolios, trackPortfolioView, getPortfolioViews30d, getPortfolioTraffic, getPortfolioViewsTotal, getPortfolioDetail } from "../controllers/portfolio.controller.js";

const router = express.Router();

router.post('/create', requireAuth, createPortfolio);
router.get('/list', requireAuth, listPortfolios);
router.get('/:portfolioId', requireAuth, getPortfolioDetail);
router.post('/track/:portfolioId', trackPortfolioView);
router.get('/:portfolioId/traffic', requireAuth, getPortfolioTraffic);
router.get('/:portfolioId/views-30d', requireAuth, getPortfolioViews30d);
router.get('/:portfolioId/views-total', requireAuth, getPortfolioViewsTotal);


export default router;