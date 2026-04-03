import type { TestResultAdapter } from "./types.js";
import { CustomAdapter } from "./custom.js";
import { junitAdapter } from "./junit.js";
import { playwrightAdapter } from "./playwright.js";
import { vrtBenchAdapter } from "./vrt-bench.js";
import { vitestAdapter } from "./vitest.js";
import { vrtMigrationAdapter } from "./vrt-migration.js";

export function createTestResultAdapter(
  type: string,
  customCommand?: string,
): TestResultAdapter {
  switch (type) {
    case "playwright":
      return playwrightAdapter;
    case "vitest":
      return vitestAdapter;
    case "junit":
      return junitAdapter;
    case "vrt-migration":
      return vrtMigrationAdapter;
    case "vrt-bench":
      return vrtBenchAdapter;
    case "custom":
      if (!customCommand) {
        throw new Error("Custom adapter requires a command (customCommand)");
      }
      return new CustomAdapter({ command: customCommand });
    default:
      throw new Error(`Unknown adapter type: ${type}`);
  }
}
