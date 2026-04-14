import { Database } from "bun:sqlite"
import { sql } from "drizzle-orm"
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite"
import { Context, Effect, Layer } from "effect"
import * as schema from "./schema.js"

export type DrizzleDB = BunSQLiteDatabase<typeof schema>

export class StorageService extends Context.Tag("operator/StorageService")<
	StorageService,
	{
		readonly db: DrizzleDB
		readonly close: () => Effect.Effect<void>
	}
>() {}

export const StorageServiceLive = (dbPath: string) =>
	Layer.scoped(
		StorageService,
		Effect.gen(function* () {
			const sqlite = new Database(dbPath)
			sqlite.exec("PRAGMA journal_mode=WAL;")
			sqlite.exec("PRAGMA foreign_keys=ON;")

			const db = drizzle(sqlite, { schema })

			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					sqlite.close()
				}),
			)

			return {
				db,
				close: () =>
					Effect.sync(() => {
						sqlite.close()
					}),
			}
		}),
	)

export function runMigrations(db: DrizzleDB): void {
	db.run(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Session',
      model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'error', 'archived')),
      resume_token TEXT,
      token_usage_input INTEGER NOT NULL DEFAULT 0,
      token_usage_output INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

	db.run(sql`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      parts TEXT NOT NULL,
      token_usage TEXT,
      created_at TEXT NOT NULL
    )
  `)

	db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)
  `)
}
