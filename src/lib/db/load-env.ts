import { config } from "dotenv";

// Side-effect module: import this FIRST in scripts so DATABASE_URL is set before the db client
// (which reads it at module load) is imported. Not used by the Next app (Next loads .env.local).
config({ path: ".env.local" });
