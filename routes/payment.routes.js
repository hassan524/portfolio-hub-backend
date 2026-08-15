import express from "express";
import requireAuth from "../middlewares/auth.js";
import { createPaymentTransaction, handlePaddleWebhook } from "../controllers/payment.controller.js";

const router = express.Router();

router.post('/create', requireAuth, createPaymentTransaction);

// Inject express.raw directly here to guarantee an untouched Buffer
router.post('/webhook', handlePaddleWebhook);

export default router;