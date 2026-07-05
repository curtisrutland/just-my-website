import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Neon credentials are injected into .env.local by the Vercel integration.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
