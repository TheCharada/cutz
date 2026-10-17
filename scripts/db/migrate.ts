import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "@/infrastructure/db/client";

const db = getDb();
const pool = getPool();

try {
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("Database migrations applied.");
} finally {
  await pool.end();
}
