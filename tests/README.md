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

## Attestation Repository — High-Volume Query Guidance

### New query methods (PR #250)

| Method | Index used | Purpose |
|---|---|---|
| `listByBusiness(client, businessId, pagination, timeoutMs?)` | `attestations_business_id_created_at_idx` | Paginated list for one business |
| `countByBusiness(client, businessId, timeoutMs?)` | `attestations_business_id_created_at_idx` | Total count for one business |
| `listByStatus(client, status, pagination, timeoutMs?)` | `attestations_status_created_at_idx` | Paginated list by status (e.g. background jobs) |

The composite indexes are created by migration `20260424_002_attestations_high_volume_indexes.sql`.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `ATTESTATION_QUERY_TIMEOUT_MS` | `0` (disabled) | Global statement timeout for all attestation queries. Set to e.g. `5000` to abort queries that run longer than 5 s. Individual call sites can override with the `timeoutMs` parameter. |

### Verifying index usage

After running the migration on a populated database, confirm the planner uses the composite indexes:

```sql
-- listByBusiness / countByBusiness
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM attestations
WHERE business_id = '<uuid>'
ORDER BY created_at DESC
LIMIT 50 OFFSET 0;
-- Expected: Index Scan using attestations_business_id_created_at_idx

-- listByStatus
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM attestations
WHERE status = 'pending'
ORDER BY created_at DESC
LIMIT 50 OFFSET 0;
-- Expected: Index Scan using attestations_status_created_at_idx
```

If the planner chooses a sequential scan, run `ANALYZE attestations;` to refresh statistics.

### Failure modes

| Scenario | Behaviour |
|---|---|
| Query exceeds `timeoutMs` | PostgreSQL raises `57014 query_canceled`; the error propagates to the caller — no silent failure. |
| `ATTESTATION_QUERY_TIMEOUT_MS` not set | No timeout is applied; queries run to completion. |
| Read-replica lag | Pass a replica `DbClient` to any read method. The repository is stateless and does not manage routing. |

### Threat model notes

**Auth / business isolation**
- `listByBusiness` and `countByBusiness` accept a raw `businessId`. Callers **must** verify that the authenticated user owns the business before passing the ID. The repository does not enforce ownership — that is the responsibility of the route/service layer (see `requireBusinessAuth` middleware).
- Passing an arbitrary `businessId` from an unauthenticated request would expose another business's attestation count and metadata. Always gate these calls behind `requireBusinessAuth`.

**Statement timeout as a DoS mitigation**
- Setting `ATTESTATION_QUERY_TIMEOUT_MS` limits the blast radius of slow queries caused by missing indexes, large offsets, or adversarial pagination parameters. Recommended value for production: `5000` (5 s).
- The timeout is applied with `SET LOCAL statement_timeout`, which is scoped to the current transaction/statement and automatically reset. It does not affect other concurrent sessions.

**Webhooks and integrations**
- Background jobs that use `listByStatus('pending', ...)` should be idempotent: re-processing a row that was already submitted must not create a duplicate on-chain transaction. Use the `Idempotency-Key` header or check `status` before submitting.
- Integration OAuth tokens are never returned by repository methods. Token storage and rotation are handled by the integrations service layer.

**Logging**
- Structured log events (`attestation.listByBusiness`, `attestation.countByBusiness`, `attestation.listByStatus`) include `businessId`, `total`, `limit`, and `offset`. These fields must not be used to infer sensitive business metrics in public-facing logs. Ensure log aggregation pipelines apply appropriate access controls.
