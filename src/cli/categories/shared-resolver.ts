import { resolve } from "node:path";
import { createResolver, type ResolverConfig } from "../resolvers/index.js";

export function createConfiguredResolver(
  affectedConfig: ResolverConfig,
  cwd: string,
) {
  return createResolver(
    {
      resolver: affectedConfig.resolver ?? "simple",
      config: affectedConfig.config ? resolve(cwd, affectedConfig.config) : undefined,
    },
    cwd,
  );
}
