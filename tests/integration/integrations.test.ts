import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express, { Express } from "express";

/**
 * Integration tests for integrations API endpoints
 *
 * Tests cover:
 * - List available integrations
 * - List connected integrations for a business
 * - Stripe OAuth connect flow
 * - Disconnect integration
 * - Protected routes return 401 when unauthenticated
 *
 * Note: Integrations routes are not yet implemented. These tests are ready
 * for when the integrations router is added to the application.
 */

// Mock integration data
const availableIntegrations = [
  {
    id: "stripe",
    name: "Stripe",
    description: "Connect your Stripe account to attest payment data",
    provider: "stripe",
    authType: "oauth2",
    status: "available",
  },
  {
    id: "shopify",
    name: "Shopify",
    description: "Connect your Shopify store to attest sales data",
    provider: "shopify",
    authType: "oauth2",
    status: "available",
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    description: "Connect QuickBooks to attest accounting data",
    provider: "quickbooks",
    authType: "oauth2",
    status: "coming_soon",
  },
];

// In-memory stores for test data
let connectedIntegrationsStore: Array<{
  id: string;
  businessId: string;
  integrationId: string;
  provider: string;
  accountId: string;
  accountName: string;
  connectedAt: string;
  status: "active" | "disconnected" | "error";
  metadata?: Record<string, unknown>;
}> = [];

let oauthStateStore: Array<{
  state: string;
  businessId: string;
  integrationId: string;
  createdAt: string;
  expiresAt: string;
}> = [];

// Mock user tokens for authentication
let mockTokens: Record<string, { userId: string; businessId: string }> = {};

// Helper to create mock integrations router
function createMockIntegrationsRouter() {
  const router = express.Router();

  // Middleware to check authentication
  const requireAuth = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.substring(7);
    const tokenData = mockTokens[token];

    if (!tokenData) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    req.user = { id: tokenData.userId };
    res.locals.businessId = tokenData.businessId;
    next();
  };

  // GET /integrations/available - List all available integrations
  router.get("/available", (_req: express.Request, res: express.Response) => {
    res.json({
      integrations: availableIntegrations,
    });
  });

  // GET /integrations/connected - List connected integrations for authenticated business
  router.get(
    "/connected",
    requireAuth,
    (_req: express.Request, res: express.Response) => {
      const businessId = res.locals.businessId as string;

      const connected = connectedIntegrationsStore
        .filter(
          (conn) => conn.businessId === businessId && conn.status === "active",
        )
        .map((conn) => ({
          id: conn.id,
          integrationId: conn.integrationId,
          provider: conn.provider,
          accountId: conn.accountId,
          accountName: conn.accountName,
          connectedAt: conn.connectedAt,
          status: conn.status,
        }));

      res.json({
        integrations: connected,
      });
    },
  );

  // POST /integrations/:integrationId/connect - Initiate OAuth connection
  router.post(
    "/:integrationId/connect",
    requireAuth,
    (req: express.Request, res: express.Response) => {
      const { integrationId } = req.params;
      const businessId = res.locals.businessId as string;

      // Check if integration exists
      const integration = availableIntegrations.find(
        (i) => i.id === integrationId,
      );

      if (!integration) {
        return res.status(404).json({ error: "Integration not found" });
      }

      if (integration.status !== "available") {
        return res.status(400).json({ error: "Integration is not available" });
      }

      // Generate OAuth state
      const state = `state_${businessId}_${integrationId}_${Date.now()}`;

      oauthStateStore.push({
        state,
        businessId,
        integrationId,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600000).toISOString(), // 10 minutes
      });

      // Return OAuth URL (mock)
      const redirectUri =
        req.body.redirectUri || "http://localhost:3000/integrations/callback";
      const authUrl = `https://connect.${integration.provider}.com/oauth/authorize?client_id=mock_client_id&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;

      res.json({
        authUrl,
        state,
      });
    },
  );

  // POST /integrations/callback - Handle OAuth callback
  router.post(
    "/callback",
    requireAuth,
    (req: express.Request, res: express.Response) => {
      const { code, state } = req.body;

      if (!code || !state) {
        return res.status(400).json({ error: "Missing code or state" });
      }

      // Verify state
      const stateEntry = oauthStateStore.find((s) => s.state === state);

      if (!stateEntry) {
        return res.status(400).json({ error: "Invalid or expired state" });
      }

      if (new Date(stateEntry.expiresAt) < new Date()) {
        return res.status(400).json({ error: "State has expired" });
      }

      const businessId = res.locals.businessId as string;

      if (stateEntry.businessId !== businessId) {
        return res.status(403).json({ error: "State does not match business" });
      }

      // Mock: Exchange code for access token and create connection
      const integration = availableIntegrations.find(
        (i) => i.id === stateEntry.integrationId,
      );

      if (!integration) {
        return res.status(404).json({ error: "Integration not found" });
      }

      const connectionId = `conn_${Date.now()}`;

      const connection = {
        id: connectionId,
        businessId,
        integrationId: integration.id,
        provider: integration.provider,
        accountId: `acct_${Date.now()}`,
        accountName: `${integration.name} Account`,
        connectedAt: new Date().toISOString(),
        status: "active" as const,
        metadata: {
          accessToken: `mock_access_token_${Date.now()}`,
          refreshToken: `mock_refresh_token_${Date.now()}`,
        },
      };

      connectedIntegrationsStore.push(connection);

      // Remove used state
      oauthStateStore = oauthStateStore.filter((s) => s.state !== state);

      res.status(201).json({
        connection: {
          id: connection.id,
          integrationId: connection.integrationId,
          provider: connection.provider,
          accountId: connection.accountId,
          accountName: connection.accountName,
          connectedAt: connection.connectedAt,
          status: connection.status,
        },
      });
    },
  );

  // DELETE /integrations/:connectionId - Disconnect integration
  router.delete(
    "/:connectionId",
    requireAuth,
    (req: express.Request, res: express.Response) => {
      const { connectionId } = req.params;
      const businessId = res.locals.businessId as string;

      const connection = connectedIntegrationsStore.find(
        (conn) => conn.id === connectionId && conn.businessId === businessId,
      );

      if (!connection) {
        return res.status(404).json({ error: "Connection not found" });
      }

      // Mark as disconnected
      connection.status = "disconnected";

      res.json({
        message: "Integration disconnected successfully",
        connectionId: connection.id,
      });
    },
  );

  return router;
}

// Test app setup
let app: Express;
let authToken: string;
let businessId: string;

beforeAll(() => {
  app = express();
  app.use(express.json());

  // Mount mock integrations router
  // TODO: Replace with actual integrations router when implemented
  app.use("/api/integrations", createMockIntegrationsRouter());

  // Setup mock authentication
  businessId = "biz_test_123";
  authToken = "token_test_123";
  mockTokens[authToken] = {
    userId: "user_test_123",
    businessId,
  };
});

beforeEach(() => {
  // Clear stores before each test
  connectedIntegrationsStore = [];
  oauthStateStore = [];
});

afterAll(() => {
  // Cleanup
  mockTokens = {};
});

describe("GET /api/integrations/available", () => {
  it("should list all available integrations without authentication", async () => {
    const response = await request(app)
      .get("/api/integrations/available")
      .expect(200);

    expect(response.body).toHaveProperty("integrations");
    expect(Array.isArray(response.body.integrations)).toBe(true);
    expect(response.body.integrations.length).toBeGreaterThan(0);

    const stripeIntegration = response.body.integrations.find(
      (i: { id: string }) => i.id === "stripe",
    );
    expect(stripeIntegration).toBeDefined();
    expect(stripeIntegration).toHaveProperty("name", "Stripe");
    expect(stripeIntegration).toHaveProperty("provider", "stripe");
    expect(stripeIntegration).toHaveProperty("authType", "oauth2");
    expect(stripeIntegration).toHaveProperty("status", "available");
  });

  it("should include integration metadata", async () => {
    const response = await request(app)
      .get("/api/integrations/available")
      .expect(200);

    const integration = response.body.integrations[0];
    expect(integration).toHaveProperty("id");
    expect(integration).toHaveProperty("name");
    expect(integration).toHaveProperty("description");
    expect(integration).toHaveProperty("provider");
    expect(integration).toHaveProperty("authType");
    expect(integration).toHaveProperty("status");
  });
});

describe("GET /api/integrations/connected", () => {
  it("should return 401 when not authenticated", async () => {
    const response = await request(app)
      .get("/api/integrations/connected")
      .expect(401);

    expect(response.body.error).toMatch(/unauthorized/i);
  });

  it("should return empty array when no integrations connected", async () => {
    const response = await request(app)
      .get("/api/integrations/connected")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toHaveProperty("integrations");
    expect(Array.isArray(response.body.integrations)).toBe(true);
    expect(response.body.integrations).toHaveLength(0);
  });

  it("should list connected integrations for authenticated business", async () => {
    // Add a connected integration
    connectedIntegrationsStore.push({
      id: "conn_1",
      businessId,
      integrationId: "stripe",
      provider: "stripe",
      accountId: "acct_123",
      accountName: "My Stripe Account",
      connectedAt: new Date().toISOString(),
      status: "active",
    });

    const response = await request(app)
      .get("/api/integrations/connected")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.integrations).toHaveLength(1);
    expect(response.body.integrations[0]).toHaveProperty("id", "conn_1");
    expect(response.body.integrations[0]).toHaveProperty(
      "integrationId",
      "stripe",
    );
    expect(response.body.integrations[0]).toHaveProperty("provider", "stripe");
    expect(response.body.integrations[0]).toHaveProperty(
      "accountId",
      "acct_123",
    );
    expect(response.body.integrations[0]).toHaveProperty("status", "active");
  });

  it("should not include disconnected integrations", async () => {
    connectedIntegrationsStore.push(
      {
        id: "conn_1",
        businessId,
        integrationId: "stripe",
        provider: "stripe",
        accountId: "acct_123",
        accountName: "Active Account",
        connectedAt: new Date().toISOString(),
        status: "active",
      },
      {
        id: "conn_2",
        businessId,
        integrationId: "shopify",
        provider: "shopify",
        accountId: "acct_456",
        accountName: "Disconnected Account",
        connectedAt: new Date().toISOString(),
        status: "disconnected",
      },
    );

    const response = await request(app)
      .get("/api/integrations/connected")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.integrations).toHaveLength(1);
    expect(response.body.integrations[0].id).toBe("conn_1");
  });

  it("should not expose sensitive metadata like tokens", async () => {
    connectedIntegrationsStore.push({
      id: "conn_1",
      businessId,
      integrationId: "stripe",
      provider: "stripe",
      accountId: "acct_123",
      accountName: "My Account",
      connectedAt: new Date().toISOString(),
      status: "active",
      metadata: {
        accessToken: "secret_token",
        refreshToken: "secret_refresh",
      },
    });

    const response = await request(app)
      .get("/api/integrations/connected")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.integrations[0]).not.toHaveProperty("metadata");
    expect(response.body.integrations[0]).not.toHaveProperty("accessToken");
    expect(response.body.integrations[0]).not.toHaveProperty("refreshToken");
  });
});

describe("POST /api/integrations/:integrationId/connect", () => {
  it("should return 401 when not authenticated", async () => {
    const response = await request(app)
      .post("/api/integrations/stripe/connect")
      .expect(401);

    expect(response.body.error).toMatch(/unauthorized/i);
  });

  it("should initiate OAuth flow for Stripe", async () => {
    const response = await request(app)
      .post("/api/integrations/stripe/connect")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ redirectUri: "http://localhost:3000/callback" })
      .expect(200);

    expect(response.body).toHaveProperty("authUrl");
    expect(response.body).toHaveProperty("state");
    expect(response.body.authUrl).toContain("connect.stripe.com");
    expect(response.body.authUrl).toContain("state=");
    expect(response.body.authUrl).toContain("redirect_uri=");
  });

  it("should return 404 for non-existent integration", async () => {
    const response = await request(app)
      .post("/api/integrations/nonexistent/connect")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(404);

    expect(response.body.error).toMatch(/not found/i);
  });

  it("should return 400 for unavailable integration", async () => {
    const response = await request(app)
      .post("/api/integrations/quickbooks/connect")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(400);

    expect(response.body.error).toMatch(/not available/i);
  });

  it("should generate unique state for each request", async () => {
    const response1 = await request(app)
      .post("/api/integrations/stripe/connect")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    const response2 = await request(app)
      .post("/api/integrations/stripe/connect")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(response1.body.state).not.toBe(response2.body.state);
  });
});

describe("POST /api/integrations/callback", () => {
  let oauthState: string;

  beforeEach(async () => {
    // Initiate OAuth flow to get state
    const connectResponse = await request(app)
      .post("/api/integrations/stripe/connect")
      .set("Authorization", `Bearer ${authToken}`);

    oauthState = connectResponse.body.state;
  });

  it("should return 401 when not authenticated", async () => {
    const response = await request(app)
      .post("/api/integrations/callback")
      .send({
        code: "auth_code_123",
        state: oauthState,
      })
      .expect(401);

    expect(response.body.error).toMatch(/unauthorized/i);
  });

  it("should complete OAuth flow and create connection", async () => {
    const response = await request(app)
      .post("/api/integrations/callback")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        code: "auth_code_123",
        state: oauthState,
      })
      .expect(201);

    expect(response.body).toHaveProperty("connection");
    expect(response.body.connection).toHaveProperty("id");
    expect(response.body.connection).toHaveProperty("integrationId", "stripe");
    expect(response.body.connection).toHaveProperty("provider", "stripe");
    expect(response.body.connection).toHaveProperty("accountId");
    expect(response.body.connection).toHaveProperty("accountName");
    expect(response.body.connection).toHaveProperty("connectedAt");
    expect(response.body.connection).toHaveProperty("status", "active");
  });

  it("should return 400 when missing code", async () => {
    const response = await request(app)
      .post("/api/integrations/callback")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ state: oauthState })
      .expect(400);

    expect(response.body.error).toMatch(/missing code/i);
  });

  it("should return 400 when missing state", async () => {
    const response = await request(app)
      .post("/api/integrations/callback")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ code: "auth_code_123" })
      .expect(400);

    expect(response.body.error).toMatch(/missing.*state/i);
  });

  it("should return 400 with invalid state", async () => {
    const response = await request(app)
      .post("/api/integrations/callback")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        code: "auth_code_123",
        state: "invalid_state",
      })
      .expect(400);

    expect(response.body.error).toMatch(/invalid or expired state/i);
  });

  it("should invalidate state after use", async () => {
    // First callback - should succeed
    await request(app)
      .post("/api/integrations/callback")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        code: "auth_code_123",
        state: oauthState,
      })
      .expect(201);

    // Second callback with same state - should fail
    const response = await request(app)
      .post("/api/integrations/callback")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        code: "auth_code_456",
        state: oauthState,
      })
      .expect(400);

    expect(response.body.error).toMatch(/invalid or expired state/i);
  });

  it("should not expose sensitive tokens in response", async () => {
    const response = await request(app)
      .post("/api/integrations/callback")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        code: "auth_code_123",
        state: oauthState,
      })
      .expect(201);

    expect(response.body.connection).not.toHaveProperty("metadata");
    expect(response.body.connection).not.toHaveProperty("accessToken");
    expect(response.body.connection).not.toHaveProperty("refreshToken");
  });
});

describe("DELETE /api/integrations/:connectionId", () => {
  let connectionId: string;

  beforeEach(async () => {
    // Create a connection
    const connectResponse = await request(app)
      .post("/api/integrations/stripe/connect")
      .set("Authorization", `Bearer ${authToken}`);

    const callbackResponse = await request(app)
      .post("/api/integrations/callback")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        code: "auth_code_123",
        state: connectResponse.body.state,
      });

    connectionId = callbackResponse.body.connection.id;
  });

  it("should return 401 when not authenticated", async () => {
    const response = await request(app)
      .delete(`/api/integrations/${connectionId}`)
      .expect(401);

    expect(response.body.error).toMatch(/unauthorized/i);
  });

  it("should disconnect integration successfully", async () => {
    const response = await request(app)
      .delete(`/api/integrations/${connectionId}`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.message).toMatch(/disconnected successfully/i);
    expect(response.body).toHaveProperty("connectionId", connectionId);
  });

  it("should return 404 for non-existent connection", async () => {
    const response = await request(app)
      .delete("/api/integrations/conn_nonexistent")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(404);

    expect(response.body.error).toMatch(/not found/i);
  });

  it("should not show disconnected integration in connected list", async () => {
    // Disconnect
    await request(app)
      .delete(`/api/integrations/${connectionId}`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    // Check connected list
    const response = await request(app)
      .get("/api/integrations/connected")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.integrations).toHaveLength(0);
  });
});

describe("Integrations flow integration", () => {
  it("should complete full connect -> list -> disconnect flow", async () => {
    // 1. List available integrations
    const availableResponse = await request(app)
      .get("/api/integrations/available")
      .expect(200);

    expect(availableResponse.body.integrations.length).toBeGreaterThan(0);

    // 2. Check no connections initially
    const emptyConnectedResponse = await request(app)
      .get("/api/integrations/connected")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(emptyConnectedResponse.body.integrations).toHaveLength(0);

    // 3. Initiate Stripe connection
    const connectResponse = await request(app)
      .post("/api/integrations/stripe/connect")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(connectResponse.body).toHaveProperty("authUrl");
    expect(connectResponse.body).toHaveProperty("state");

    // 4. Complete OAuth callback
    const callbackResponse = await request(app)
      .post("/api/integrations/callback")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        code: "auth_code_123",
        state: connectResponse.body.state,
      })
      .expect(201);

    const connectionId = callbackResponse.body.connection.id;

    // 5. Verify connection appears in connected list
    const connectedResponse = await request(app)
      .get("/api/integrations/connected")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(connectedResponse.body.integrations).toHaveLength(1);
    expect(connectedResponse.body.integrations[0].id).toBe(connectionId);

    // 6. Disconnect integration
    await request(app)
      .delete(`/api/integrations/${connectionId}`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    // 7. Verify connection no longer in connected list
    const finalConnectedResponse = await request(app)
      .get("/api/integrations/connected")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(finalConnectedResponse.body.integrations).toHaveLength(0);
  });

  it("should handle multiple integrations for same business", async () => {
    // Connect Stripe
    const stripeConnectResponse = await request(app)
      .post("/api/integrations/stripe/connect")
      .set("Authorization", `Bearer ${authToken}`);

    await request(app)
      .post("/api/integrations/callback")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        code: "stripe_code",
        state: stripeConnectResponse.body.state,
      })
      .expect(201);

    // Connect Shopify
    const shopifyConnectResponse = await request(app)
      .post("/api/integrations/shopify/connect")
      .set("Authorization", `Bearer ${authToken}`);

    await request(app)
      .post("/api/integrations/callback")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        code: "shopify_code",
        state: shopifyConnectResponse.body.state,
      })
      .expect(201);

    // Verify both connections
    const connectedResponse = await request(app)
      .get("/api/integrations/connected")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(connectedResponse.body.integrations).toHaveLength(2);

    const providers = connectedResponse.body.integrations.map(
      (i: { provider: string }) => i.provider,
    );
    expect(providers).toContain("stripe");
    expect(providers).toContain("shopify");
  });
});

// ─── Shopify HMAC Property-Based Tests ───────────────────────────────────────

import fc from "fast-check";
import { computeShopifyHmac } from "../../src/services/integrations/shopify/callback.js";

describe("computeShopifyHmac — property-based tests", () => {
  // Property 1: HMAC round-trip (determinism)
  // Validates: Requirements 1.1, 1.2, 8.1, 8.2
  it("Property 1: same inputs always produce the same digest (determinism)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.dictionary(fc.string(), fc.string()),
        (secret, params) => {
          const first = computeShopifyHmac(secret, params);
          const second = computeShopifyHmac(secret, params);
          return first === second;
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 2: HMAC order-independence (confluence)
  // Validates: Requirements 2.2, 8.4
  it("Property 2: shuffled key insertion order produces the same digest (order-independence)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.dictionary(fc.string(), fc.string()),
        (secret, params) => {
          // Build a shuffled copy of params
          const entries = Object.entries(params);
          for (let i = entries.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [entries[i], entries[j]] = [entries[j], entries[i]];
          }
          const shuffled = Object.fromEntries(entries);

          return computeShopifyHmac(secret, params) === computeShopifyHmac(secret, shuffled);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 3: HMAC excludes the `hmac` key
  // Validates: Requirements 2.1, 8.3
  it("Property 3: adding, removing, or changing the `hmac` key does not affect the digest", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.dictionary(fc.string(), fc.string()),
        fc.string(),
        (secret, params, hmacValue) => {
          // Baseline: params without any `hmac` key
          const { hmac: _removed, ...withoutHmac } = params;
          const baseline = computeShopifyHmac(secret, withoutHmac);

          // With `hmac` key added
          const withHmac = { ...withoutHmac, hmac: hmacValue };
          const withHmacResult = computeShopifyHmac(secret, withHmac);

          // With `hmac` key set to a different value
          const withDifferentHmac = { ...withoutHmac, hmac: hmacValue + "_mutated" };
          const withDifferentHmacResult = computeShopifyHmac(secret, withDifferentHmac);

          return baseline === withHmacResult && baseline === withDifferentHmacResult;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Task 3.2: handleCallback — env guard ────────────────────────────────────

import { handleCallback } from "../../src/services/integrations/shopify/callback.js";
import * as shopifyStore from "../../src/services/integrations/shopify/store.js";

describe("handleCallback — env guard", () => {
  const originalClientId = process.env.SHOPIFY_CLIENT_ID;
  const originalClientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  afterEach(() => {
    // Restore original env values
    if (originalClientId === undefined) {
      delete process.env.SHOPIFY_CLIENT_ID;
    } else {
      process.env.SHOPIFY_CLIENT_ID = originalClientId;
    }
    if (originalClientSecret === undefined) {
      delete process.env.SHOPIFY_CLIENT_SECRET;
    } else {
      process.env.SHOPIFY_CLIENT_SECRET = originalClientSecret;
    }
  });

  it("returns 'Shopify app not configured' when SHOPIFY_CLIENT_ID is missing", async () => {
    delete process.env.SHOPIFY_CLIENT_ID;
    process.env.SHOPIFY_CLIENT_SECRET = "some-secret";
    const result = await handleCallback({ code: "c", shop: "s", state: "st" });
    expect(result).toEqual({ success: false, error: "Shopify app not configured" });
  });

  it("returns 'Shopify app not configured' when SHOPIFY_CLIENT_SECRET is missing", async () => {
    process.env.SHOPIFY_CLIENT_ID = "some-client-id";
    delete process.env.SHOPIFY_CLIENT_SECRET;
    const result = await handleCallback({ code: "c", shop: "s", state: "st" });
    expect(result).toEqual({ success: false, error: "Shopify app not configured" });
  });

  it("returns 'Shopify app not configured' when both env vars are empty strings", async () => {
    process.env.SHOPIFY_CLIENT_ID = "";
    process.env.SHOPIFY_CLIENT_SECRET = "";
    const result = await handleCallback({ code: "c", shop: "s", state: "st" });
    expect(result).toEqual({ success: false, error: "Shopify app not configured" });
  });
});

// ─── Task 4.3: Property 4 — Tampered parameter causes HMAC rejection ─────────

describe("computeShopifyHmac — property-based tests", () => {
  // Property 4: Tampered param causes HMAC rejection
  // Validates: Requirements 1.3
  it("Property 4: mutating any non-hmac parameter causes handleCallback to return Invalid HMAC signature", async () => {
    const savedClientId = process.env.SHOPIFY_CLIENT_ID;
    const savedClientSecret = process.env.SHOPIFY_CLIENT_SECRET;

    process.env.SHOPIFY_CLIENT_ID = "test-client-id";
    process.env.SHOPIFY_CLIENT_SECRET = "test-secret";

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          code: fc.string({ minLength: 1 }),
          shop: fc.constant("test-shop.myshopify.com"),
          state: fc.string({ minLength: 1 }),
        }),
        async (params) => {
          const hmac = computeShopifyHmac("test-secret", params);
          const tamperedParams = { ...params, code: params.code + "_tampered", hmac };
          const result = await handleCallback(tamperedParams);
          return result.error === "Invalid HMAC signature";
        },
      ),
      { numRuns: 100 },
    );

    if (savedClientId === undefined) {
      delete process.env.SHOPIFY_CLIENT_ID;
    } else {
      process.env.SHOPIFY_CLIENT_ID = savedClientId;
    }
    if (savedClientSecret === undefined) {
      delete process.env.SHOPIFY_CLIENT_SECRET;
    } else {
      process.env.SHOPIFY_CLIENT_SECRET = savedClientSecret;
    }
  });

  // Property 5: Missing required params rejected without side effects
  // Validates: Requirements 3.1, 3.2
  it("Property 5: params missing any required field causes handleCallback to return success: false", async () => {
    process.env.SHOPIFY_CLIENT_ID = "test-client-id";
    process.env.SHOPIFY_CLIENT_SECRET = "test-secret";

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant({ shop: "test.myshopify.com", state: "abc", hmac: "xyz" }),
          fc.constant({ code: "abc", state: "abc", hmac: "xyz" }),
          fc.constant({ code: "abc", shop: "test.myshopify.com", hmac: "xyz" }),
          fc.constant({ code: "abc", shop: "test.myshopify.com", state: "abc" }),
        ),
        async (params) => {
          const result = await handleCallback(params as Record<string, string>);
          return result.success === false;
        },
      ),
      { numRuns: 100 },
    );

    delete process.env.SHOPIFY_CLIENT_ID;
    delete process.env.SHOPIFY_CLIENT_SECRET;
  });
});

// ─── Task 4.5: handleCallback — HMAC and params validation ───────────────────

describe("handleCallback — HMAC and params validation", () => {
  beforeEach(() => {
    process.env.SHOPIFY_CLIENT_ID = "test-client-id";
    process.env.SHOPIFY_CLIENT_SECRET = "test-secret";
  });

  afterEach(() => {
    delete process.env.SHOPIFY_CLIENT_ID;
    delete process.env.SHOPIFY_CLIENT_SECRET;
  });

  function makeValidParams(secret: string) {
    const params = { code: "auth-code", shop: "mystore.myshopify.com", state: "nonce-123" };
    const hmac = computeShopifyHmac(secret, params);
    return { ...params, hmac };
  }

  it("valid HMAC proceeds past HMAC check", async () => {
    const params = makeValidParams("test-secret");
    const result = await handleCallback(params);
    expect(result.error).not.toBe("Invalid HMAC signature");
  });

  it("tampered HMAC returns Invalid HMAC signature", async () => {
    const params = makeValidParams("test-secret");
    const tampered = { ...params, code: "different-code" };
    const result = await handleCallback(tampered);
    expect(result).toEqual({ success: false, error: "Invalid HMAC signature" });
  });

  it("missing hmac param returns Missing HMAC signature", async () => {
    const result = await handleCallback({
      code: "auth-code",
      shop: "mystore.myshopify.com",
      state: "nonce-123",
    });
    expect(result).toEqual({ success: false, error: "Missing HMAC signature" });
  });

  it("empty hmac param returns Missing HMAC signature", async () => {
    const result = await handleCallback({
      code: "auth-code",
      shop: "mystore.myshopify.com",
      state: "nonce-123",
      hmac: "",
    });
    expect(result).toEqual({ success: false, error: "Missing HMAC signature" });
  });

  it("missing code returns Missing required callback parameters", async () => {
    const result = await handleCallback({
      shop: "mystore.myshopify.com",
      state: "nonce-123",
      hmac: "somehash",
    });
    expect(result).toEqual({ success: false, error: "Missing required callback parameters" });
  });

  it("missing shop returns Missing required callback parameters", async () => {
    const result = await handleCallback({
      code: "auth-code",
      state: "nonce-123",
      hmac: "somehash",
    });
    expect(result).toEqual({ success: false, error: "Missing required callback parameters" });
  });

  it("missing state returns Missing required callback parameters", async () => {
    const result = await handleCallback({
      code: "auth-code",
      shop: "mystore.myshopify.com",
      hmac: "somehash",
    });
    expect(result).toEqual({ success: false, error: "Missing required callback parameters" });
  });

  it("HMAC validated before state nonce is consumed (ordering guarantee)", async () => {
    // Seed the store with a valid nonce
    shopifyStore.setOAuthState("nonce-123", "mystore.myshopify.com");

    // Call handleCallback with a tampered HMAC (so HMAC check fails)
    const params = makeValidParams("test-secret");
    const tampered = { ...params, code: "tampered-code" };
    const result = await handleCallback(tampered);

    expect(result).toEqual({ success: false, error: "Invalid HMAC signature" });

    // The nonce must NOT have been consumed — it should still be in the store
    const remaining = shopifyStore.consumeOAuthState("nonce-123");
    expect(remaining).toBe("mystore.myshopify.com");
  });
});

// ─── Task 5.2: Property 6 — Invalid shop hostname rejected after HMAC, before state consumed ───

describe("computeShopifyHmac — property-based tests", () => {
  // Property 6: Invalid shop hostname rejected after HMAC, before state consumed
  // Validates: Requirements 4.1, 4.2, 3.3
  it("Property 6: invalid shop hostname rejected after HMAC passes, state nonce remains unconsumed", async () => {
    process.env.SHOPIFY_CLIENT_ID = "test-client-id";
    process.env.SHOPIFY_CLIENT_SECRET = "test-secret";

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter(
          (s) => !/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(s),
        ),
        fc.string({ minLength: 1 }),
        async (invalidShop, state) => {
          // Seed the store with the nonce
          shopifyStore.setOAuthState(state, "some-shop.myshopify.com");

          // Build params with the invalid shop and compute a valid HMAC over them
          const baseParams = { code: "auth-code", shop: invalidShop, state };
          const hmac = computeShopifyHmac("test-secret", baseParams);
          const params = { ...baseParams, hmac };

          const result = await handleCallback(params);

          // The nonce must still be in the store (not consumed)
          const remaining = shopifyStore.consumeOAuthState(state);

          return result.error === "Invalid shop hostname" && remaining !== undefined;
        },
      ),
      { numRuns: 50 },
    );

    delete process.env.SHOPIFY_CLIENT_ID;
    delete process.env.SHOPIFY_CLIENT_SECRET;
  });
});

// ─── Task 5.3: handleCallback — shop hostname validation ─────────────────────

describe("handleCallback — shop hostname validation", () => {
  beforeEach(() => {
    process.env.SHOPIFY_CLIENT_ID = "test-client-id";
    process.env.SHOPIFY_CLIENT_SECRET = "test-secret";
  });

  afterEach(() => {
    delete process.env.SHOPIFY_CLIENT_ID;
    delete process.env.SHOPIFY_CLIENT_SECRET;
  });

  it("valid .myshopify.com hostname proceeds past shop check", async () => {
    const params = { code: "auth-code", shop: "mystore.myshopify.com", state: "nonce-abc" };
    const hmac = computeShopifyHmac("test-secret", params);
    const result = await handleCallback({ ...params, hmac });
    expect(result.error).not.toBe("Invalid shop hostname");
  });

  it("hostname with dots in subdomain is rejected", async () => {
    const params = { code: "auth-code", shop: "my.store.myshopify.com", state: "nonce-abc" };
    const hmac = computeShopifyHmac("test-secret", params);
    const result = await handleCallback({ ...params, hmac });
    expect(result).toEqual({ success: false, error: "Invalid shop hostname" });
  });

  it("non-myshopify domain is rejected", async () => {
    const params = { code: "auth-code", shop: "mystore.shopify.com", state: "nonce-abc" };
    const hmac = computeShopifyHmac("test-secret", params);
    const result = await handleCallback({ ...params, hmac });
    expect(result).toEqual({ success: false, error: "Invalid shop hostname" });
  });

  it("shop hostname is normalized to lowercase before validation", async () => {
    // HMAC is computed with the mixed-case shop value (raw params)
    const params = { code: "auth-code", shop: "MyStore.myshopify.com", state: "nonce-abc" };
    const hmac = computeShopifyHmac("test-secret", params);
    const result = await handleCallback({ ...params, hmac });
    // Normalization happens inside handleCallback, so shop validation should pass
    // Result will be 'Invalid or expired state' (no nonce seeded), not 'Invalid shop hostname'
    expect(result.error).not.toBe("Invalid shop hostname");
  });
});

// ─── Task 6.2: Property 7 — State nonce consumed exactly once ────────────────

describe("computeShopifyHmac — property-based tests", () => {
  // Property 7: State nonce consumed exactly once
  // Validates: Requirements 5.1, 5.5
  it("Property 7: state nonce is absent from Token_Store after handleCallback returns, regardless of token exchange outcome", async () => {
    process.env.SHOPIFY_CLIENT_ID = "test-client-id";
    process.env.SHOPIFY_CLIENT_SECRET = "test-secret";

    // Stub fetch so token exchange fails immediately (network error) without hanging
    vi.stubGlobal("fetch", () => Promise.reject(new Error("Network error")));

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1 }),
          async (state) => {
            // Seed the store with the nonce
            shopifyStore.setOAuthState(state, "mystore.myshopify.com");

            // Build valid params and compute valid HMAC
            const baseParams = { code: "auth-code", shop: "mystore.myshopify.com", state };
            const hmac = computeShopifyHmac("test-secret", baseParams);
            const params = { ...baseParams, hmac };

            // Call handleCallback — fails at token exchange (stubbed), that's fine
            await handleCallback(params);

            // The nonce must be gone from the store (consumed on first use)
            const remaining = shopifyStore.consumeOAuthState(state);
            return remaining === undefined;
          },
        ),
        { numRuns: 50 },
      );
    } finally {
      vi.unstubAllGlobals();
      delete process.env.SHOPIFY_CLIENT_ID;
      delete process.env.SHOPIFY_CLIENT_SECRET;
    }
  });
});

// ─── Task 6.3: handleCallback — state nonce validation ───────────────────────

describe("handleCallback — state nonce validation", () => {
  beforeEach(() => {
    process.env.SHOPIFY_CLIENT_ID = "test-client-id";
    process.env.SHOPIFY_CLIENT_SECRET = "test-secret";
    // Stub fetch so token exchange fails immediately without hanging
    vi.stubGlobal("fetch", () => Promise.reject(new Error("Network error")));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SHOPIFY_CLIENT_ID;
    delete process.env.SHOPIFY_CLIENT_SECRET;
  });

  function makeValidParamsForShop(secret: string, shop: string, state: string) {
    const params = { code: "auth-code", shop, state };
    const hmac = computeShopifyHmac(secret, params);
    return { ...params, hmac };
  }

  it("state not in store returns Invalid or expired state", async () => {
    // Do NOT seed the store — state is absent
    const params = makeValidParamsForShop("test-secret", "mystore.myshopify.com", "nonce-not-seeded");
    const result = await handleCallback(params);
    expect(result).toEqual({ success: false, error: "Invalid or expired state" });
  });

  it("state found but shop mismatch returns Invalid or expired state", async () => {
    // Seed with a different shop
    shopifyStore.setOAuthState("nonce-abc", "other-shop.myshopify.com");
    const params = makeValidParamsForShop("test-secret", "mystore.myshopify.com", "nonce-abc");
    const result = await handleCallback(params);
    expect(result).toEqual({ success: false, error: "Invalid or expired state" });
  });

  it("state consumed after first use (replay prevention)", async () => {
    // Seed the store
    shopifyStore.setOAuthState("nonce-abc", "mystore.myshopify.com");
    const params = makeValidParamsForShop("test-secret", "mystore.myshopify.com", "nonce-abc");

    // First call — will fail at token exchange (stubbed), but nonce should be consumed
    await handleCallback(params);

    // Nonce must be gone
    const remaining = shopifyStore.consumeOAuthState("nonce-abc");
    expect(remaining).toBeUndefined();
  });
});

// ─── Task 8.2: handleCallback — token exchange ───────────────────────────────

describe("handleCallback — token exchange", () => {
  function makeValidParamsForTokenExchange() {
    const params = { code: "auth-code", shop: "mystore.myshopify.com", state: "nonce-abc" };
    const hmac = computeShopifyHmac("test-secret", params);
    return { ...params, hmac };
  }

  beforeEach(() => {
    process.env.SHOPIFY_CLIENT_ID = "test-client-id";
    process.env.SHOPIFY_CLIENT_SECRET = "test-secret";
    shopifyStore.setOAuthState("nonce-abc", "mystore.myshopify.com");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SHOPIFY_CLIENT_ID;
    delete process.env.SHOPIFY_CLIENT_SECRET;
  });

  it("network error returns Token exchange request failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    shopifyStore.setOAuthState("nonce-abc", "mystore.myshopify.com");
    const result = await handleCallback(makeValidParamsForTokenExchange());
    expect(result).toEqual({ success: false, error: "Token exchange request failed" });
  });

  it("non-2xx response returns Token exchange failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    shopifyStore.setOAuthState("nonce-abc", "mystore.myshopify.com");
    const result = await handleCallback(makeValidParamsForTokenExchange());
    expect(result).toEqual({ success: false, error: "Token exchange failed" });
  });

  it("response missing access_token returns No access token in response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }));
    shopifyStore.setOAuthState("nonce-abc", "mystore.myshopify.com");
    const result = await handleCallback(makeValidParamsForTokenExchange());
    expect(result).toEqual({ success: false, error: "No access token in response" });
  });

  it("successful flow returns success true with normalized shop", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "shpat_test123" }),
    }));
    shopifyStore.setOAuthState("nonce-abc", "mystore.myshopify.com");
    const result = await handleCallback(makeValidParamsForTokenExchange());
    expect(result).toEqual({ success: true, shop: "mystore.myshopify.com" });
  });
});
