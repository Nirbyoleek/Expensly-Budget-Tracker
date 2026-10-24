import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // server modules guard against client bundles with "server-only"; tests import them directly
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    // keep each test file's globals (fetch, env) to itself
    unstubGlobals: true,
    unstubEnvs: true,
    coverage: { provider: "v8", include: ["lib/**/*.ts", "app/api/**/*.ts"], exclude: ["**/__tests__/**"] },
  },
});
