import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror the tsconfig `@/*` -> ./src/* alias so tests resolve the same imports as Next.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // infographics/ is its own package with its own tests (docs/infographics.md §1).
    exclude: [...configDefaults.exclude, "infographics/**"],
  },
});
