import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  test: { include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"], fileParallelism: false },
});
