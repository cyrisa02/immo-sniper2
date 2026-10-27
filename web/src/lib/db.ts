// web/src/lib/db.ts
import { Pool } from "pg";

export const pool = new Pool({
  user: process.env.DB_USER || "immo_user",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "immo_db",
  password: process.env.DB_PASSWORD || "immo_secret",
  port: parseInt(process.env.DB_PORT || "5432"),
});
