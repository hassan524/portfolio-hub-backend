// src/server.js
import dotenv from "dotenv";
dotenv.config(); 

import express from "express";
import cors from "cors";
import paymentRoutes from "./routes/payment.routes.js";
import portfolioRoutes from "./routes/portfolio.route.js";
import deployRoutes from "./routes/deploy.routes.js";
import cookieParser from "cookie-parser";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: ["http://localhost:5173", "https://ngrok-free.app"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning"],
  credentials: true
}));

// Middleware to parse cookies and JSON bodies
app.use(cookieParser());
app.use(express.json({
  verify: (req, res, buf) => {
    if (req.originalUrl.includes('/api/payment/webhook')) {
      req.rawBody = buf.toString('utf-8');
    }
  }
}));

// Api routes 

app.use("/api/payment", paymentRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/deploy", deployRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});