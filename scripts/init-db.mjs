// Initialise the database schema. Usage: npm run db:init
// Requires POSTGRES_URL in the environment (or .env.local).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local if present (simple parser; no dependency).
try {
  const env = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  // no .env.local; rely on real environment
}

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  console.error("POSTGRES_URL is not set. Set it in .env.local or your shell.");
  process.exit(1);
}

const schema = readFileSync(join(__dirname, "..", "db", "schema.sql"), "utf8");
const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(schema);
  console.log("Database schema created / verified successfully.");
} catch (err) {
  console.error("Failed to initialise database:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
