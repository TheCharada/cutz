import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getDatabaseEnv } from "@/config/env";
import * as schema from "./schema";

function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString });
  return {
    pool,
    db: drizzle(pool, { schema }),
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];

let instance: ReturnType<typeof createDatabase> | undefined;

function getDatabaseInstance() {
  if (!instance) {
    const { DATABASE_URL } = getDatabaseEnv();
    instance = createDatabase(DATABASE_URL);
  }

  return instance;
}

export function getDb() {
  return getDatabaseInstance().db;
}

export function getPool() {
  return getDatabaseInstance().pool;
}
