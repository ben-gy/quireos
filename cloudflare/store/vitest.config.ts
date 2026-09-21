import { defineConfig } from "vitest/config";

// Plain vitest over the Hono handlers. D1 is faked with node:sqlite (real SQL,
// same migration file) and R2 with an in-memory map; see test/fake_env.ts.
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "hono/jsx" },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
