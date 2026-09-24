// src/cli/contracts/jev-compat.ts
/**
 * Compile-time check that flaker's jev-context is what jev-test-filter
 * reads. Not exported from the package (its .d.ts would reference a
 * devDependency). `pnpm typecheck` fails if the shapes diverge.
 */
import type { JevContext } from "jev-test-filter/types";
import type { JevContextV1 } from "./jev-context-v1.js";

type Assignable<A, B> = A extends B ? true : false;
export const JEV_CONTEXT_COMPATIBLE: Assignable<JevContextV1, JevContext> = true;
