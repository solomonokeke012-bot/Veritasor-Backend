-- Migration: attestations high-volume composite indexes
--
-- These indexes support the high-volume query patterns in attestationRepository.ts.
-- Each index is designed for a specific access pattern and should be verified with
-- EXPLAIN (ANALYZE, BUFFERS) after creation on production data.
--
-- Index: attestations_business_id_created_at_idx
--   Supports: listByBusiness, countByBusiness
--   Query pattern: WHERE business_id = $1 ORDER BY created_at DESC LIMIT n OFFSET m
--   Expected plan: Index Scan (or Index Only Scan for COUNT) on this index.
--   At high volume (>100k rows/business) a sequential scan on the base table
--   would be O(n); this index keeps it O(log n + k) where k = page size.
--
-- Index: attestations_status_created_at_idx
--   Supports: listByStatus
--   Query pattern: WHERE status = $1 ORDER BY created_at DESC LIMIT n OFFSET m
--   Expected plan: Index Scan on this index.
--   Particularly useful for background jobs polling 'pending'/'submitted' rows.
--
-- Both indexes use CONCURRENTLY to avoid locking the table during creation on
-- live databases.  Remove CONCURRENTLY if running inside a transaction block.

CREATE INDEX CONCURRENTLY IF NOT EXISTS attestations_business_id_created_at_idx
  ON attestations (business_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS attestations_status_created_at_idx
  ON attestations (status, created_at DESC);
