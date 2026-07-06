import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * The Drizzle client, over Neon's serverless HTTP driver (`neon-http`) — never a vanilla pg
 * Pool, which exhausts connections on the serverless path (CONVENTIONS / HANDOFF constraint).
 * `DATABASE_URL` is read from the environment (Vercel-injected in prod; `.env.local` locally).
 */
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });

export * from "./schema";
