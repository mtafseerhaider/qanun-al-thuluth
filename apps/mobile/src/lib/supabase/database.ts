import type { Database as GeneratedDatabase } from '@shared/db/database.types';

/**
 * Database type used by the app client: the generated types from `packages/shared` (regenerated for
 * the Sprint 1 migrations). Kept as a seam so a future local override has one place to live.
 */
export type Database = GeneratedDatabase;

type PublicTables = Database['public']['Tables'];
export type TableRow<T extends keyof PublicTables> = PublicTables[T]['Row'];
export type TableInsert<T extends keyof PublicTables> = PublicTables[T]['Insert'];
