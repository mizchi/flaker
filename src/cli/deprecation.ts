import type { Command } from "commander";

export interface DeprecationOpts {
  since: string;
  remove: string;
  canonical: string;
}

function fullPath(cmd: Command): string {
  const parts: string[] = [];
  let current: Command | null = cmd;
  while (current) {
    // Skip the root program (no parent) to avoid duplicating the "flaker" prefix
    if (current.parent != null) {
      const n = current.name();
      if (n) parts.unshift(n);
    }
    current = (current.parent as Command | null) ?? null;
  }
  return parts.join(" ");
}

export function deprecate(cmd: Command, opts: DeprecationOpts): Command {
  const prefix = `DEPRECATED in ${opts.since} (removed in ${opts.remove})`;
  const description = cmd.description();
  cmd.description(`${prefix} — use \`${opts.canonical}\` instead. ${description}`);

  const warn = () => {
    const path = fullPath(cmd);
    process.stderr.write(
      `warning: \`flaker ${path}\` is deprecated and will be removed in ${opts.remove}. `
      + `Use \`${opts.canonical}\` instead.\n`,
    );
  };

  const existing = (cmd as unknown as { _actionHandler?: (...args: unknown[]) => unknown })._actionHandler;
  cmd.action(async (...args: unknown[]): Promise<void> => {
    warn();
    if (existing) await existing(...args);
  });

  const origOutputHelp = cmd.outputHelp.bind(cmd);
  cmd.outputHelp = ((contextOrFn?: unknown) => {
    warn();
    return origOutputHelp(contextOrFn as Parameters<typeof origOutputHelp>[0]);
  }) as typeof cmd.outputHelp;

  return cmd;
}
