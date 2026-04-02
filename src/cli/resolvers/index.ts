import type { DependencyResolver } from "./types.js";
import { SimpleResolver } from "./simple.js";
import { BitflowNativeResolver } from "./bitflow-native.js";
import { WorkspaceResolver } from "./workspace.js";
import { MoonResolver } from "./moon.js";

export type { DependencyResolver } from "./types.js";
export { SimpleResolver } from "./simple.js";
export { BitflowNativeResolver } from "./bitflow-native.js";
export { WorkspaceResolver } from "./workspace.js";
export { MoonResolver } from "./moon.js";

export interface ResolverConfig {
  resolver: string;
  config?: string;
}

export function createResolver(
  config: ResolverConfig,
  rootDir: string,
): DependencyResolver {
  switch (config.resolver) {
    case "git":
    case "simple":
      return new SimpleResolver();
    case "bitflow":
      if (!config.config) throw new Error("bitflow resolver requires a config path");
      return new BitflowNativeResolver(config.config);
    case "workspace":
      return new WorkspaceResolver(rootDir);
    case "moon":
      return new MoonResolver(rootDir);
    default:
      throw new Error(`Unknown resolver: ${config.resolver}`);
  }
}
