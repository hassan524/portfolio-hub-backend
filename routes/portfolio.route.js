import express from "express";
import requireAuth from "../middlewares/auth.js";
import portfolioController from "../controllers/portfolio.controller.js";

const router = express.Router();

router.post('/create', requireAuth, portfolioController.createPortfolio);
router.get('/list', requireAuth, portfolioController.listPortfolios);
router.get('/:portfolioId', requireAuth, portfolioController.getPortfolioDetail);
router.post('/track/:portfolioId', portfolioController.trackPortfolioView);

router.get('/:portfolioId/viewsRange', requireAuth, portfolioController.getPortfolioRangeViews);

router.get('/:portfolioId/views-30d', requireAuth, portfolioController.getPortfolioViews30d);
router.get('/:portfolioId/views-total', requireAuth, portfolioController.getPortfolioViewsTotal);

router.get('/:portfolioId/overview', requireAuth, portfolioController.getPortfolioOverviewData);
router.get('/:portfolioId/traffic', requireAuth, portfolioController.getPortfolioTrafficData);

router.put('/:portfolioId/site-data', requireAuth, portfolioController.updatePortfolioSiteData);
router.put('/:portfolioId', requireAuth, portfolioController.updatePortfolioSiteData);
router.post('/:portfolioId/redeploy', requireAuth, portfolioController.redeployPortfolio);
router.delete('/:portfolioId', requireAuth, portfolioController.deletePortfolio);

export default router;