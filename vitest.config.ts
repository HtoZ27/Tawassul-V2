import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    
    
    
    
    pool: "threads",
    
    
    
    
    testTimeout: 60000,
    hookTimeout: 60000,
    teardownTimeout: 60000,
    globals: true,
    setupFiles: ["./vitest-setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/mission-board/board-*.json", "**/.new-services-*/**"],
    
    
    maxWorkers: 3,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/coverage/**",
        "**/*.test.ts",
        "**/mission-board/board-*.json",
        "**/.new-services-*/**",
      ],
    },
  },
});
