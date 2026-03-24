import "./config/index.js"; // Validates env vars on startup — throws if any are missing
import express from "express";
import cors from "cors";
import { attestationsRouter } from "./routes/attestations.js";
import { healthRouter } from "./routes/health.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { analyticsRouter } from './routes/analytics.js'
import businessRoutes from './routes/businesses.js'
import { razorpayWebhookRouter } from './routes/webhooks-razorpay.js' // ADD THIS

export const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.use('/api/health', healthRouter)
app.use('/api/attestations', attestationsRouter)
app.use('/api/businesses', businessRoutes)
app.use('/api/analytics', analyticsRouter)
app.use('/api/webhooks/razorpay', razorpayWebhookRouter)

app.use(errorHandler);

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Veritasor API listening on http://localhost:${PORT}`);
  });
}
