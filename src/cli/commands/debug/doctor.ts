import { formatConfigWarning, loadConfig, loadConfigWithDiagnostics, validateConfigRanges } from "../../config.js";
import { hasMoonBitJsBuild } from "../../core/loader.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  warnings?: string[];
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
}

export interface DoctorDeps {
  createStore: () => { initialize: () => Promise<void>; close: () => Promise<void> };
  hasMoonBitBuild: () => Promise<boolean>;
  canLoadConfig: () => boolean;
  getConfigWarnings: () => string[];
}

export async function runDoctor(cwd: string, deps?: Partial<DoctorDeps>): Promise<DoctorReport> {
  const resolved: DoctorDeps = {
    createStore: deps?.createStore ?? (() => { throw new Error("createStore is not configured"); }),
    hasMoonBitBuild: deps?.hasMoonBitBuild ?? hasMoonBitJsBuild,
    canLoadConfig: deps?.canLoadConfig ?? (() => {
      loadConfig(cwd);
      return true;
    }),
    getConfigWarnings: deps?.getConfigWarnings ?? (() =>
      loadConfigWithDiagnostics(cwd).warnings.map(formatConfigWarning)),
  };

  const checks: DoctorCheck[] = [];

  // Config check
  try {
    const ok = resolved.canLoadConfig();
    const warnings = ok ? resolved.getConfigWarnings() : [];
    checks.push({
      name: "config",
      ok,
      detail: ok ? "flaker.toml is readable" : "flaker.toml check returned false",
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (error) {
    checks.push({
      name: "config",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // Config range check
  try {
    const config = loadConfig(cwd);
    const rangeErrors = validateConfigRanges(config);
    if (rangeErrors.length === 0) {
      checks.push({ name: "config ranges", ok: true, detail: "all values within expected ranges" });
    } else {
      for (const err of rangeErrors) {
        checks.push({
          name: "config ranges",
          ok: false,
          detail: `${err.path}=${err.value} out of range (${err.expected})`,
        });
      }
    }
  } catch {
    // config may be missing or invalid — other checks already cover this
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
    if (c.warnings) {
      for (const warning of c.warnings) {
        lines.push(`WARN  ${warning}`);
      }
    }
    if (!c.ok && REMEDIATION[c.name]) {
      lines.push(`              → ${REMEDIATION[c.name]}`);
    }
  }
  lines.push("");
  lines.push(report.ok ? "Doctor checks passed." : "Doctor checks failed.");
  return lines.join("\n");
}
