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
  - `business.test.ts` - Business CRUD tests + **analytics route auth enforcement**
  - `integrations.test.ts` - Integrations API tests (list, connect, disconnect, OAuth flow)

## Test Setup

Tests use:
- **Jest** - Test framework
- **Supertest** - HTTP assertion library for testing Express apps
- **ts-jest** - TypeScript support for Jest

## Analytics Tests

The analytics integration tests (in `business.test.ts`) cover:

### Routes

| Method | Path                        | Auth Required | Rate Limit        |
|--------|-----------------------------|---------------|-------------------|
| GET    | `/api/analytics/periods`    | Business Auth | 30 req / 15 min   |
| GET    | `/api/analytics/revenue`    | Business Auth | 30 req / 15 min   |

### Auth error shapes (stable contract)

| Status | `code`                | Trigger                                      |
|--------|-----------------------|----------------------------------------------|
| 401    | `MISSING_AUTH`        | Missing or malformed `Authorization` header  |
| 401    | `INVALID_TOKEN`       | Expired, invalid, or revoked JWT             |
| 400    | `MISSING_BUSINESS_ID` | No `x-business-id` header or body field      |
| 403    | `BUSINESS_NOT_FOUND`  | Business not found or not owned by the user  |

### Test scenarios

1. **401 MISSING_AUTH** – request with no `Authorization` header
2. **401 INVALID_TOKEN** – request with an expired/invalid token
3. **403 BUSINESS_NOT_FOUND** – valid token but wrong business (role mismatch)
4. **400 bad params** – missing `period`/`from`/`to`, invalid YYYY-MM format, only `from` without `to`
5. **404 no data** – authenticated but no attestations for the requested window
6. **200 success** – valid auth + valid params returns revenue report
7. **Rate-limit headers** – `X-RateLimit-Bucket: analytics`, `X-RateLimit-Limit: 30`

### Mock strategy

`requireBusinessAuth` is mocked with `vi.mock` so tests run without a real database.
The mock simulates the exact response shapes the real middleware produces:

```typescript
// Successful auth – sets req.business so setBusinessLocals can copy to res.locals
mockRequireBusinessAuth.mockImplementation((req, res, next) => {
  req.business = { id: 'biz-1', userId: 'user-1', ... }
  next()
})

// Auth failure – returns stable 401/403 shape
mockRequireBusinessAuth.mockImplementation((_req, res) => {
  res.status(401).json({ error: '...', message: '...', code: 'MISSING_AUTH' })
})
```

Analytics services (`listAttestedPeriodsForBusiness`, `getRevenueReport`) are also mocked
so tests are deterministic and do not require a running database.

### Threat model notes

- **Token expiry mid-request**: `requireBusinessAuth` re-validates the token on every request
  (no session cache). An expired token returns `INVALID_TOKEN` regardless of prior success.
- **Role mismatch**: The middleware checks `business.userId === req.user.id` after fetching
  the business from the DB. A valid token for user A cannot access user B's business.
- **Cached sessions**: There is no server-side session cache; each request is independently
  authenticated. Revoked tokens are rejected as soon as the DB user-existence check fails.
- **Webhooks / integrations**: Webhook endpoints use separate HMAC signature verification
  and do not share the analytics rate-limit bucket.

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

## Attestation Repository — High-Volume Query Guidance

### Overview

`src/repositories/attestationRepository.ts` is designed to remain performant
under high attestation volume (thousands of records per business, large page
sizes, concurrent writes).  The patterns below are enforced by the unit tests
in `tests/unit/repositories/attestationRepository.test.ts`.

### Indexes

The migration `20260225_001_create_attestations_table.sql` creates three
indexes that all repository queries are written to exploit:

| Index | Columns | Used by |
|---|---|---|
| `attestations_business_id_idx` | `business_id` | `list` (businessId filter), `getByBusinessAndPeriod` |
| `attestations_status_idx` | `status` | future status-filtered queries |
| `attestations_created_at_idx` | `created_at DESC` | `list` ORDER BY |

The composite UNIQUE constraint on `(business_id, period)` doubles as an index
for `getByBusinessAndPeriod` lookups.

**Operator checklist** — run `EXPLAIN (ANALYZE, BUFFERS)` on the following
queries after any schema change and confirm index scans (not seq scans) are
used for tables with > 10 000 rows:

```sql
-- list by business
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM attestations WHERE business_id = $1 ORDER BY created_at DESC LIMIT 50;

-- lookup by business + period
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM attestations WHERE business_id = $1 AND period = $2;
```

### Statement Timeout

Every repository function issues `SET LOCAL statement_timeout = <ms>` before
executing its data query.  This cancels runaway queries before they exhaust
the connection pool.

| Environment variable | Default | Effect |
|---|---|---|
| `ATTESTATION_QUERY_TIMEOUT_MS` | `5000` | Max ms a single query may run |

Set to `0` to disable (not recommended in production).

PostgreSQL raises error code `57014` (`query_canceled`) when the timeout fires.
The repository does **not** catch `57014` — it propagates to the caller so the
HTTP layer can return `503 Service Unavailable` or retry with backoff.

### Structured Logging

Two thresholds trigger a `[WARN]` structured JSON log entry:

| Environment variable | Default | Trigger |
|---|---|---|
| `SLOW_QUERY_WARN_MS` | `1000` | Query elapsed time ≥ threshold |
| `SLOW_QUERY_ROW_THRESHOLD` | `500` | Result row count ≥ threshold |

Example log entry:

```json
{
  "event": "attestation_repo_slow_query",
  "op": "list",
  "elapsedMs": 1340,
  "rowCount": 620,
  "thresholdMs": 1000,
  "thresholdRows": 500,
  "businessId": "biz-abc",
  "limit": 1000,
  "offset": 0,
  "total": 620
}
```

Forward these entries to your log aggregator (ELK, Datadog, CloudWatch) and
alert when `elapsedMs` exceeds your SLA budget.

### Failure Modes

| Failure | pg error code | Repository behaviour |
|---|---|---|
| Statement timeout | `57014` | Propagates — caller must handle |
| Duplicate insert | `23505` | Wrapped as `ConflictError` (DUPLICATE) |
| Foreign-key violation | `23503` | Wrapped as `ConflictError` (FOREIGN_KEY) |
| Version mismatch | — | Wrapped as `ConflictError` (VERSION_MISMATCH) |
| Connection error | varies | Propagates unwrapped |

### Read Replicas (Future)

The `client` parameter on every function is intentionally injectable.  When a
read replica is available, pass a replica pool client to `getById`,
`getByBusinessAndPeriod`, and `list` to offload read traffic.  Write functions
(`create`, `update`, `updateStatus`, `remove`) must always use the primary.

### Threat Model Notes

- **Auth**: All repository functions accept a `DbClient` and perform no
  authentication themselves.  Callers (route handlers) are responsible for
  ensuring the authenticated user owns the `businessId` before passing it to
  the repository.  See `requireBusinessAuth` middleware.
- **Injection**: All queries use parameterised placeholders (`$1`, `$2`, …).
  No string interpolation of user-supplied values occurs.
- **Timeout abuse**: A malicious client cannot force a long-running query by
  sending a large `limit` — the statement timeout caps wall-clock execution
  regardless of result size.
- **Webhooks / integrations**: Webhook endpoints use separate HMAC signature
  verification and do not share the attestation rate-limit bucket.
- **Idempotency**: `createWithConflictCheck` with `returnExistingOnConflict: true`
  provides idempotent create semantics; duplicate submissions return the
  existing record rather than creating a second one.

---

## requireBusinessAuth Middleware

### What it does

`src/middleware/requireBusinessAuth.ts` enforces business-scoped authentication
on every route it guards.  It is applied to all analytics and any future
business-scoped endpoints.

### Error codes (stable contract)

| Status | `code` | Trigger |
|--------|--------|---------|
| 401 | `MISSING_AUTH` | Missing or malformed `Authorization` header |
| 401 | `INVALID_TOKEN` | Expired, invalid, or revoked JWT; user deleted after token issued (token replay) |
| 400 | `MISSING_BUSINESS_ID` | No `x-business-id` header and no `business_id`/`businessId` body field |
| 403 | `BUSINESS_NOT_FOUND` | Business absent or owned by a different user |
| 403 | `BUSINESS_SUSPENDED` | Business exists and is owned by the user but is suspended |

### Business ID extraction priority

1. `x-business-id` request header
2. `body.business_id`
3. `body.businessId`

### Structured logs

| Event | Level | Fields |
|-------|-------|--------|
| `business_auth.success` | INFO | `userId`, `businessId` |
| `business_auth.suspended` | WARN | `userId`, `businessId` |

### Threat model notes

- **Token replay**: `findUserById` is called on every request so a token for a
  deleted user is rejected immediately — there is no server-side session cache.
- **Role mismatch**: `business.userId === req.user.id` is checked after fetching
  the business from the DB.  A valid token for user A cannot access user B's
  business.
- **Suspended businesses**: The `suspended` flag on the business record is
  checked after ownership is confirmed.  Suspended businesses receive `403
  BUSINESS_SUSPENDED` rather than `BUSINESS_NOT_FOUND` so operators can
  distinguish the two states in logs.
- **Injection**: Business ID is validated against `/^[a-zA-Z0-9\-_]{1,50}$/`
  before it is passed to the repository.
- **Webhooks / integrations**: Webhook endpoints use separate HMAC signature
  verification and do not share this middleware.

### Cross-route consistency

The same middleware instance is used on all business-scoped routers
(`analytics`, `attestations`, and any future routes).  The test suite in
`tests/unit/middleware/requireBusinessAuth.test.ts` runs every error-code
scenario against all three route contexts via `it.each` to guarantee identical
error shapes regardless of which router the request hits.

---

## API Version Negotiation Middleware

### Negotiation sources (priority order)

| Priority | Source | Example |
|----------|--------|---------|
| 1 | URL path prefix | `/api/v1/health` |
| 2 | `X-API-Version` header | `X-API-Version: 1` |
| 3 | `Accept-Version` header | `Accept-Version: v1` |
| 4 | Query param | `?apiVersion=1` or `?api_version=1` |
| 5 | `Accept` parameter | `Accept: application/json; version=1` |
| 6 | Default | `v1` |

### Response headers (stable contract)

| Header | Value | Condition |
|--------|-------|-----------|
| `API-Version` | Supported label (e.g. `v1`) | Always |
| `API-Version-Fallback` | `true` | Only when requested version is unsupported |
| `Vary` | Merged with `Accept, X-API-Version, Accept-Version` | Always |

### Failure modes / edge cases

- **Unsupported major** (e.g. `v99`): falls back to `v1`, sets `API-Version-Fallback: true`. No 4xx is returned — clients must check the fallback header.
- **Invalid version strings** (`garbage`, `v1beta`, `0`, `-1`, floats): ignored; negotiation falls through to the next source.
- **Overlong inputs**: `parseVersionToken` rejects strings > 32 chars; `extractVersionFromAccept` rejects Accept headers > 1024 chars (ReDoS / header-smuggling guard).
- **CRLF-injected headers**: rejected by `parseVersionToken` (no `\r\n` matches `/^v?(\d+)$/`).

### Adding a new major version

1. Append the label to `SUPPORTED_API_VERSIONS` in `src/middleware/apiVersion.ts`.
2. Mount the new router under `/api/v{n}` in `src/app.ts`.
3. Add a contract test asserting `source=path`, `version=v{n}`, `fallback=false`.

### Threat model notes

- Version tokens are validated against `/^v?(\d+)$/` — arbitrary strings are never reflected in response headers.
- Path-segment parsing caps digit length at 3 to prevent integer overflow and ReDoS.
- `Vary` header is merged (not replaced) so upstream cache entries for different versions are kept distinct.
