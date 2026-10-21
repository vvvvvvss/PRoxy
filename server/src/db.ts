import pg from "pg";
import "dotenv/config";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/ghagent",
});
