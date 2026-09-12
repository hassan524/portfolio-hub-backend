import express from "express";
import requireAuth from "../middlewares/auth.js";
import paymentController from "../controllers/payment.controller.js";

const router = express.Router();

router.post('/create', requireAuth, paymentController.createPaymentTransaction);
router.post('/webhook', paymentController.handlePaddleWebhook);

export default router;