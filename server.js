import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "./.env") });
dotenv.config();

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import paymentRoutes from "./routes/payment.routes.js";
import portfolioRoutes from "./routes/portfolio.route.js";
import deployRoutes from "./routes/deploy.routes.js";
import domainRoutes from "./routes/domain.routes.js";
import seoRoutes from "./routes/seo.routes.js";
import { startSeoBackgroundWorker } from "./services/seoBackgroundWorker.service.js";

const app = express();
const PORT = process.env.PORT || 5000;

// Public tracking endpoint allowed from any origin (viewer-app deployments & local previews)
app.use("/api/portfolio/track", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Accept, ngrok-skip-browser-warning");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Configure CORS with local and configured environment origins
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
  "https://ngrok-free.app",
];
if (process.env.FRONTEND_URL && !allowedOrigins.includes(process.env.FRONTEND_URL)) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or server-to-server)
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith(".vercel.app") ||
        origin.endsWith(".netlify.app") ||
        origin.includes("ngrok-free.app")
      ) {
        return callback(null, true);
      }
      return callback(null, true); // Permissive in development
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning"],
    credentials: true,
  }),
);

// Middleware to parse cookies
app.use(cookieParser());

// Global JSON body parser with 50MB limit to support large template deployments and preserve rawBody for webhooks
app.use(
  express.json({
    limit: "50mb",
    verify: (req, res, buf) => {
      if (req.originalUrl.includes("/api/payment/webhook")) {
        req.rawBody = buf.toString("utf-8");
      }
    },
  }),
);

// URL-encoded body parser
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Health check endpoint
app.get("/health", (req, res) => res.status(200).json({ status: "ok", timestamp: new Date().toISOString() }));

// API routes
app.use("/api/payment", paymentRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/portfolios", portfolioRoutes);
app.use("/api/deploy", deployRoutes);
app.use("/api/portfolio", domainRoutes);
app.use("/api/portfolio", seoRoutes);
app.use("/api/seo", seoRoutes);

// 404 Route Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(`[Error] ${req.method} ${req.originalUrl}:`, err);

  const statusCode = err.status || err.statusCode || 500;
  const message = err.message || "Internal server error";

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === "development" ? { stack: err.stack } : {}),
  });
});

app.listen(PORT, () => {
  console.log(`PortfolioHub Backend running on http://localhost:${PORT}`);
  startSeoBackgroundWorker();
});