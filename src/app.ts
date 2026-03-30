import express, { type Express } from "express";
import cors from "cors";
import type { Server } from "node:http";
import { config } from "./config/index.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { apiVersionMiddleware, versionResponseMiddleware } from "./middleware/apiVersion.js";
import { analyticsRouter } from "./routes/analytics.js";
import { authRouter } from "./routes/auth.js";
import { attestationsRouter } from "./routes/attestations.js";
import businessRoutes from "./routes/businesses.js";
import { healthRouter } from "./routes/health.js";
import integrationsRouter from "./routes/integrations.js";
import integrationsRazorpayRouter from "./routes/integrations-razorpay.js";
import { integrationsShopifyRouter } from "./routes/integrations-shopify.js";
import { attestationReminderJob } from "./jobs/attestationReminder.js";
import { runStartupDependencyReadinessChecks } from "./startup/readiness.js";

/**
 * Build the Express app with all API middleware and routes.
 */
export function createApp(): Express {
  const expressApp = express();

  expressApp.use(apiVersionMiddleware);
  expressApp.use(versionResponseMiddleware);
  expressApp.use(cors(config.cors));
  expressApp.use(express.json());
  expressApp.use(requestLogger);

  expressApp.use("/api/health", healthRouter);
  expressApp.use("/api/auth", authRouter);
  expressApp.use("/api/attestations", attestationsRouter);
  expressApp.use("/api/businesses", businessRoutes);
  expressApp.use("/api/analytics", analyticsRouter);
  expressApp.use("/api/integrations/shopify", integrationsShopifyRouter);
  expressApp.use("/api/integrations/razorpay", integrationsRazorpayRouter);
  expressApp.use("/api/integrations", integrationsRouter);

  expressApp.use(errorHandler);

  return expressApp;
}

export const app = createApp();

/**
 * Start the API server only after startup dependency checks succeed.
 *
 * @throws Error when required dependencies are not ready.
 */
export async function startServer(port: number): Promise<Server> {
  const readinessReport = await runStartupDependencyReadinessChecks();

  if (!readinessReport.ready) {
    const failedChecks = readinessReport.checks
      .filter((check) => !check.ready)
      .map((check) => `${check.dependency}: ${check.reason ?? "failed"}`)
      .join("; ");

    throw new Error(`Startup dependency readiness checks failed (${failedChecks})`);
  }

  return app.listen(port, () => {
    console.log(`Veritasor API listening on http://localhost:${port}`);
    setInterval(attestationReminderJob, 60 * 1000);
  });
}
