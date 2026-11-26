/**
 * Deprecated. Seeding is now an explicit operator action: POST /api/seed
 * (see src/app/api/seed/route.ts), disabled in production unless
 * ALLOW_DEMO_SEED=true is set (development only).
 *
 * This module used to unconditionally create a merchant with no credentials,
 * so it has been removed rather than left importable.
 */
export {}
