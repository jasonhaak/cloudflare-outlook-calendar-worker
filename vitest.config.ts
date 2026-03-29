import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use Node.js environment so Intl / Date APIs work identically to CF Workers v8
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
