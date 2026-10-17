import "dotenv/config";
import { getPool } from "@/infrastructure/db/client";
import { seedDatabase } from "./seed";

try {
  await seedDatabase({ includeDemoFixtures: false });
  console.log("Production bootstrap applied.");
} finally {
  await getPool().end();
}
