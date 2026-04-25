# Integration Tests

This directory contains integration tests for the Veritasor Backend API.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Test Structure

- `integration/` - Integration tests that test complete API flows
  - `auth.test.ts` - Authentication API tests (signup, login, refresh, password reset)
  - `integrations.test.ts` - Integrations API tests (list, connect, disconnect, OAuth flow)

## Test Setup

Tests use:
- **Jest** - Test framework
- **Supertest** - HTTP assertion library for testing Express apps
- **ts-jest** - TypeScript support for Jest

## Auth Tests

The auth integration tests cover:

1. **User Signup** - Creating new user accounts
2. **User Login** - Authentication with credentials
3. **Token Refresh** - Refreshing access tokens
4. **Get Current User** - Fetching authenticated user info
5. **Forgot Password** - Initiating password reset flow
6. **Reset Password** - Completing password reset with token

## Integrations Tests

The integrations integration tests cover:

1. **List Available Integrations** - Get all available integrations (public endpoint)
2. **List Connected Integrations** - Get connected integrations for authenticated business
3. **Stripe OAuth Connect** - Initiate and complete OAuth flow
4. **Disconnect Integration** - Remove integration connection
5. **Authentication** - Protected routes return 401 when unauthenticated
6. **Security** - Sensitive tokens not exposed in responses

### Mock Implementation

Currently, the tests include a mock auth router since the actual auth routes are not yet implemented. The mock:
- Uses in-memory stores for users, tokens, and reset tokens
- Simulates password hashing (prefixes with "hashed_")
- Implements proper token validation
- Follows security best practices (e.g., no email enumeration)

The integrations tests include a mock integrations router. The mock:
- Uses in-memory stores for connections and OAuth state
- Simulates OAuth flow with state generation and validation
- Implements proper authentication checks
- Follows security best practices (no token exposure, state validation)

### When Auth Routes Are Implemented

Replace the mock router in `auth.test.ts` with the actual auth router:

```typescript
// Remove createMockAuthRouter() function
// Import actual auth router
import { authRouter } from '../../src/routes/auth.js'

// In beforeAll:
app.use('/api/auth', authRouter)
```

### When Integrations Routes Are Implemented

Replace the mock router in `integrations.test.ts` with the actual integrations router:

```typescript
// Remove createMockIntegrationsRouter() function
// Import actual integrations router
import { integrationsRouter } from '../../src/routes/integrations.js'

// In beforeAll:
app.use('/api/integrations', integrationsRouter)
```

## Database Strategy

For integration tests with a real database:

1. **Test Database** - Use a separate test database
2. **Migrations** - Run migrations before tests
3. **Cleanup** - Clear data between tests
4. **Transactions** - Wrap tests in transactions and rollback

Example setup:

```typescript
beforeAll(async () => {
  await db.migrate.latest()
})

beforeEach(async () => {
  await db.raw('BEGIN')
})

afterEach(async () => {
  await db.raw('ROLLBACK')
})

afterAll(async () => {
  await db.destroy()
})
```

## Best Practices

- Test complete user flows, not just individual endpoints
- Use descriptive test names that explain the scenario
- Clean up test data between tests
- Don't expose sensitive information in error messages
- Test both success and failure cases
- Verify security requirements (401, 403, etc.)
- Test OAuth state validation and expiration
- Ensure tokens and credentials are not leaked in responses

## End-to-End (E2E) Testing Plan

The E2E tests verify the complete system flow, including the API, backend services, database, and Soroban contract interactions.

### Testing Philosophy
E2E tests should focus on the "Happy Path" user journeys and critical failure points that integration tests might miss due to mocks.

### E2E Scenarios

#### 1. Complete Attestation Lifecycle
- **Goal**: Verify a merchant can fetch revenue and submit a verified attestation on-chain.
- **Steps**:
    1. Merchant logs into the dashboard.
    2. Merchant initiates a sync for a specific period (e.g., "2025-Q1").
    3. Backend fetches data from connected integrations (Shopify/Razorpay).
    4. Backend generates a Merkle root.
    5. Backend submits the root to the Soroban contract.
    6. Verify the transaction hash is recorded and the root is queryable on the Stellar network.

#### 2. Multi-Source Integration Sync
- **Goal**: Ensure revenue data from multiple sources is correctly aggregated.
- **Steps**:
    1. User connects both Stripe and Shopify.
    2. Initiate a consolidated sync.
    3. Verify that the Merkle tree leaves contain data from both sources accurately.

### Security & Resilience Testing
- **Rate Limiting**: Verify that excessive requests from a single IP/User are throttled.
- **Idempotency**: Ensure that re-submitting an attestation with the same `Idempotency-Key` does not create duplicate on-chain transactions.
- **Auth Resilience**: Test deep-link authentication and token rotation flows.

### Performance & Scaling
- **Load Testing**: Simulate 100+ concurrent attestation submissions to ensure the Soroban RPC and DB pool can handle the load.
- **Large Dataset Aggregation**: Test sync operations with 10,000+ line items.

## Security Assumptions & Validations

The following security assumptions are baked into the system and must be validated by the E2E suite:

1. **Isolation of Business Data**:
    - *Assumption*: A user cannot sync or view revenue for a business they do not own.
    - *Validation*: E2E tests must attempt unauthorized sync requests and verify `403 Forbidden` responses.

2. **Tamper-Proof Merkle Proofs**:
    - *Assumption*: The Merkle root submitted on-chain accurately represents the source data.
    - *Validation*: Verify that changing a single revenue entry locally results in a Merkle proof mismatch against the on-chain root.

3. **Key Management**:
    - *Assumption*: Private keys are never exposed in logs or API responses.
    - *Validation*: Audit log assertions in E2E tests must scan for sensitive strings (G... or S... keys).

4. **Idempotency Integrity**:
    - *Assumption*: Multiple identical requests do not result in multiple on-chain transactions (saving gas/fees).
    - *Validation*: Check local database for single record entry after multiple POST bursts.


---

## Stripe Webhook Replay Resistance

### Overview

The Stripe webhook endpoint (`POST /api/integrations/stripe/webhook`) is hardened against replay attacks and duplicate event delivery. The implementation lives in `src/services/integrations/stripe/callback.ts` and is exercised by two test suites.

### Security Properties

| Property | Mechanism |
|---|---|
| Replay resistance | Timestamp tolerance window (default 300 s). Events older than 5 min or more than 5 min in the future are rejected with **401**. |
| Signature verification | HMAC-SHA256 over `<timestamp>.<rawBody>` using `STRIPE_WEBHOOK_SECRET`. Constant-time comparison prevents timing attacks. |
| Duplicate suppression | In-process `SeenEventStore` keyed by Stripe event ID with 2 TTL eviction. Duplicates return **200** (so Stripe stops retrying) with `{ note: "duplicate" }`. |
| No secret leakage | Rejection responses never echo the signing secret, raw body, or upstream error details. |
| Clock-skew guard | Future timestamps beyond the tolerance window are also rejected. |

### Required Environment Variables

| Variable | Description |
|---|---|
| `STRIPE_WEBHOOK_SECRET` | Webhook endpoint signing secret from the Stripe dashboard (`whsec_...`). Missing  **500**. |
| `STRIPE_CLIENT_ID` | OAuth app client ID (for connect/callback flow). |
| `STRIPE_CLIENT_SECRET` | OAuth app client secret (for token exchange). |
| `STRIPE_REDIRECT_URI` | OAuth redirect URI registered in Stripe dashboard. |
| `STRIPE_SUCCESS_REDIRECT` | (Optional) URL to redirect to after successful OAuth connect. |

### Failure Modes

| Scenario | HTTP Status | Body |
|---|---|---|
| Missing `Stripe-Signature` header | 401 | `{ error: "Webhook signature verification failed" }` |
| Wrong signing secret | 401 | `{ error: "Webhook signature verification failed" }` |
| Timestamp too old (> 300 s) | 401 | `{ error: "Webhook signature verification failed" }` |
| Timestamp too far in future | 401 | `{ error: "Webhook signature verification failed" }` |
| Duplicate event ID | 200 | `{ received: true, note: "duplicate" }` |
| Invalid JSON payload | 400 | `{ error: "Invalid webhook payload" }` |
| `STRIPE_WEBHOOK_SECRET` not set | 500 | `{ error: "Webhook endpoint not configured" }` |
| Valid event | 200 | `{ received: true }` |

### Multi-Instance Deployments

The `SeenEventStore` is in-process only. For horizontally-scaled deployments, replace it with a shared Redis SET:

```typescript
// In src/services/integrations/stripe/callback.ts
// Replace seenEventStore with a Redis-backed implementation:
export const seenEventStore = new RedisSeenEventStore(redisClient, {
  ttlSeconds: STRIPE_WEBHOOK_TOLERANCE_SECONDS * 2,
})
```

### Test Coverage

**Unit tests** (`tests/unit/services/integrations/stripe/callback.test.ts`)  70 tests:
- `SeenEventStore`: TTL eviction, duplicate detection, clear
- `isValidStripeOAuthState`: format validation (length, charset, case)
- `parseStripeSignatureHeader`: well-formed, multiple sigs, malformed, edge cases
- `computeStripeSignature`: determinism, sensitivity to each input
- `verifyStripeWebhook`: happy path, missing/wrong signature, replay (stale + future timestamps), duplicate event IDs, out-of-order delivery, invalid payload, no secret leakage
- `handleCallback`: OAuth state validation, CSRF protection, network errors, idempotent upsert, no token leakage

**Integration tests** (`tests/integration/stripe-webhook.test.ts`)  15 tests:
- End-to-end HTTP response codes through the Express route layer
- Replay attack via stale timestamp  401
- Replay attack via re-signed fresh timestamp with same event ID  200 duplicate
- Duplicate delivery  200 with `note: "duplicate"`
- Missing/wrong secret  401
- Body tampering  401
- Missing `STRIPE_WEBHOOK_SECRET` env var  500
- No secret leakage in error responses

### Running the Tests

```bash
# Unit tests only
node node_modules/vitest/vitest.mjs run tests/unit/services/integrations/stripe/callback.test.ts

# Integration tests only
node node_modules/vitest/vitest.mjs run tests/integration/stripe-webhook.test.ts

# Both together
node node_modules/vitest/vitest.mjs run tests/unit/services/integrations/stripe/callback.test.ts tests/integration/stripe-webhook.test.ts

# Full suite
node node_modules/vitest/vitest.mjs run
```

### Threat Model Notes

**Replay attacks**: Stripe signs each webhook with a timestamp embedded in the `Stripe-Signature` header. The 300-second tolerance window means an attacker who captures a valid webhook has at most 5 minutes to replay it before the timestamp check rejects it. The `SeenEventStore` provides a second layer: even within the window, a replayed event ID is rejected.

**Timing attacks**: All signature comparisons use `crypto.timingSafeEqual`. The expected signature is always computed before comparison, so the comparison time is constant regardless of how many bytes match.

**CSRF on OAuth callback**: The `state` parameter is a 32-byte cryptographically random hex token stored server-side with a 10-minute expiry. It is consumed on first use, preventing replay of the OAuth callback URL.

**Secret confidentiality**: No signing secret, access token, or refresh token is ever included in log output or API responses. Structured log entries record only machine-readable event names and non-sensitive metadata (event ID, event type, HTTP status codes).


---

## Startup Dependency Readiness Checks

### Overview

`src/startup/readiness.ts` validates all critical dependencies **before the HTTP listener opens**. If any required check fails, `startServer()` throws and the process exits with code 1  the app never accepts traffic in a broken state.

### Checks performed (in order)

| # | Dependency | Condition | Environments |
|---|---|---|---|
| 1 | `config/jwt` | `JWT_SECRET` present and >= 32 chars | production |
| 1 | `config/jwt` | `JWT_SECRET` present and >= 8 chars | non-production |
| 2 | `config/soroban` | `SOROBAN_CONTRACT_ID` present | production only |
| 3 | `config/stripe` | `STRIPE_WEBHOOK_SECRET` present | production only |
| 4 | `database` | `SELECT 1` probe succeeds within 2.5 s | when `DATABASE_URL` is set |

### Required Environment Variables

| Variable | Required in | Reason |
|---|---|---|
| `JWT_SECRET` | All environments (>= 8 chars); production (>= 32 chars) | Auth token signing |
| `SOROBAN_CONTRACT_ID` | Production | Attestation contract address  omitting it would silently no-op submissions |
| `STRIPE_WEBHOOK_SECRET` | Production | Webhook signature verification  omitting it allows unsigned events |
| `DATABASE_URL` | Optional | When set, a connectivity probe is run at startup |

### Failure Modes

| Scenario | Failure reason emitted |
|---|---|
| `JWT_SECRET` not set | `JWT_SECRET is not set` |
| `JWT_SECRET` too short (dev) | `JWT_SECRET must be at least 8 characters (got N)` |
| `JWT_SECRET` too short (prod) | `JWT_SECRET must be at least 32 characters in production (got N)` |
| `SOROBAN_CONTRACT_ID` missing in prod | `SOROBAN_CONTRACT_ID must be set in production` |
| `STRIPE_WEBHOOK_SECRET` missing in prod | `STRIPE_WEBHOOK_SECRET must be set in production` |
| DB connection refused | `database connection failed: connect ECONNREFUSED [redacted]` |
| DB probe timeout | `database probe timed out after 2500 ms` |

### Security Notes

- Failure reasons **never** include secret values or raw connection strings.
- The `sanitiseDbError()` helper strips `postgres://...` and `postgresql://...` substrings from error messages before they are written to logs or the readiness report.
- The database probe is read-only (`SELECT 1`) with a 2.5-second bounded timeout.
- All readiness decisions are emitted as a single structured JSON log entry (`event: startup_readiness_report`) for log aggregation.

### Observability

Every boot emits a structured log entry:

```json
{
  "event": "startup_readiness_report",
  "ready": false,
  "env": "production",
  "checks": [
    { "dependency": "config/jwt", "ready": true },
    { "dependency": "config/soroban", "ready": false, "reason": "SOROBAN_CONTRACT_ID must be set in production" },
    { "dependency": "config/stripe", "ready": true },
    { "dependency": "database", "ready": true }
  ]
}
```

Passing checks omit the `reason` field to keep happy-path logs terse.

### Test Coverage

Tests live in `tests/integration/auth.test.ts` under the **"Startup dependency readiness checks"** describe block  22 tests:

**config/jwt** (6 tests): dev/prod thresholds, missing, whitespace-only

**config/soroban** (3 tests): prod enforcement, dev bypass, set in prod

**config/stripe** (3 tests): prod enforcement, dev bypass, set in prod

**database** (3 tests): skip when unset, connection refused reason, timeout reason

**report structure** (5 tests): all dependency names present, aggregation, no-leakage, passing checks have no reason field

**sanitiseDbError** (4 tests): postgres/postgresql redaction, clean messages, case-insensitive

### Threat Model Notes

**Auth (`config/jwt`):** A short or absent `JWT_SECRET` in production allows tokens to be forged. The 32-char minimum provides >= 128 bits of entropy for HMAC-SHA256.

**Webhooks (`config/stripe`):** Without `STRIPE_WEBHOOK_SECRET`, the webhook endpoint accepts any unsigned POST as a legitimate Stripe event. Blocking startup prevents this misconfiguration from reaching production.

**Integrations (`config/soroban`):** An empty `SOROBAN_CONTRACT_ID` causes attestation submissions to silently discard on-chain writes. Blocking startup surfaces this before any merchant data is processed.

**Database:** The probe uses a read-only `SELECT 1` with a 2.5-second timeout. Credentials are redacted from error messages by `sanitiseDbError()`.
