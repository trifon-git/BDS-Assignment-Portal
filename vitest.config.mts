import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest needs the same `@/` alias the app uses. Until now every test imported
 * relatively and got away without it; the database-backed ones cannot, because
 * the modules under test import `@/db`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // better-sqlite3 is a native module; keep tests in the Node environment.
    environment: "node",
  },
});
