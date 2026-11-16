import { defineConfig } from "vitest/config";

// Its own config, so a test run here never climbs to the site's vitest.config.ts and its setup.
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
