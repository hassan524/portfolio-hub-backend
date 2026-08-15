import express from "express";
import requireAuth from "../middlewares/auth.js";
import { createPortfolio } from "../controllers/portfolio.controller.js";

const router = express.Router();

router.post('/create', requireAuth, createPortfolio);


export default router;