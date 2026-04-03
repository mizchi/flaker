import { loadConfig } from "../config.js";
import { hasMoonBitJsBuild } from "../core/loader.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
}

export interface DoctorDeps {
  createStore: () => { initialize: () => Promise<void>; close: () => Promise<void> };
  hasMoonBitBuild: () => Promise<boolean>;
  canLoadConfig: () => boolean;
}

export async function runDoctor(cwd: string, deps?: Partial<DoctorDeps>): Promise<DoctorReport> {
  const resolved: DoctorDeps = {
    createStore: deps?.createStore ?? (() => { throw new Error("createStore is not configured"); }),
    hasMoonBitBuild: deps?.hasMoonBitBuild ?? hasMoonBitJsBuild,
    canLoadConfig: deps?.canLoadConfig ?? (() => {
      loadConfig(cwd);
      return true;
    }),
  };

  const checks: DoctorCheck[] = [];

  // Config check
  try {
    const ok = resolved.canLoadConfig();
    checks.push({
      name: "config",
      ok,
      detail: ok ? "flaker.toml is readable" : "flaker.toml check returned false",
    });
  } catch (error) {
    checks.push({
      name: "config",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // DuckDB check
  const store = resolved.createStore();
  let storeInitialized = false;
  try {
    await store.initialize();
    storeInitialized = true;
    await store.close();
    checks.push({ name: "duckdb", ok: true, detail: "DuckDB initialized successfully" });
  } catch (error) {
    checks.push({
      name: "duckdb",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (storeInitialized) {
      try {
        await store.close();
      } catch {
        // best effort
      }
    }
  }

  // MoonBit build check
  try {
    const hasBuild = await resolved.hasMoonBitBuild();
    checks.push({
      name: "moonbit",
      ok: true,
      detail: hasBuild
        ? "MoonBit JS build detected"
        : "MoonBit JS build not found (TypeScript fallback will be used)",
    });
  } catch (error) {
    checks.push({
      name: "moonbit",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    checks,
    ok: checks.every((c) => c.ok),
  };
}

const REMEDIATION: Record<string, string> = {
  config: "Run 'flaker init --owner <org> --name <repo>' to create one",
  duckdb: "Run 'pnpm rebuild duckdb' or 'npm rebuild duckdb'",
  moonbit: "Install MoonBit from https://moonbitlang.com (optional, fallback available)",
};

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  for (const c of report.checks) {
    lines.push(`${c.ok ? "OK" : "NG"}  ${c.name.padEnd(10)}${c.detail}`);
    if (!c.ok && REMEDIATION[c.name]) {
      lines.push(`              → ${REMEDIATION[c.name]}`);
    }
  }
  lines.push("");
  lines.push(report.ok ? "Doctor checks passed." : "Doctor checks failed.");
  return lines.join("\n");
}
