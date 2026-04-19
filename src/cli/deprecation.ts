import type { Command } from "commander";

export interface DeprecationOpts {
  /** Version in which the command became deprecated. */
  since: string;
  /** Version in which the command will be removed. */
  remove: string;
  /** The canonical replacement, e.g. "flaker status". */
  canonical: string;
}

function fullPath(cmd: Command): string {
  const parts: string[] = [];
  let current: Command | null = cmd;
  while (current) {
    const n = current.name();
    if (n) parts.unshift(n);
    current = (current.parent as Command | null) ?? null;
  }
  return parts.join(" "); // e.g. "flaker analyze query"
}

export function deprecate(cmd: Command, opts: DeprecationOpts): Command {
  const prefix = `DEPRECATED in ${opts.since} (removed in ${opts.remove})`;
  const description = cmd.description();
  cmd.description(`${prefix} — use \`${opts.canonical}\` instead. ${description}`);

  // Lazily compute the full path so that commands registered before .name()
  // is set on the root program still resolve to the correct "flaker ..." path.
  const warn = () => {
    const name = fullPath(cmd);
    process.stderr.write(
      `warning: \`${name}\` is deprecated and will be removed in ${opts.remove}. `
      + `Use \`${opts.canonical}\` instead.\n`,
    );
  };

  // Intercept future .action() calls on this command so the warning is
  // automatically prepended to whatever handler is registered.
  const originalAction = cmd.action.bind(cmd);
  cmd.action = (fn: (...fnArgs: unknown[]) => unknown): Command => {
    return originalAction(async (...fnArgs: unknown[]) => {
      warn();
      await fn(...fnArgs);
    });
  };

  // Re-register the already-set action (if any) through the interceptor so
  // the warning fires even when .action() was called before deprecate().
  // We reach into Commander internals to grab the stored user fn and
  // re-register it, rather than trying to call _actionHandler directly.
  type CmdInternal = { _actionHandler: ((...a: unknown[]) => unknown) | null };
  const internal = cmd as unknown as CmdInternal;
  if (internal._actionHandler !== null) {
    // Temporarily remove the current _actionHandler so that cmd.action()
    // (now our interceptor) installs a fresh one.
    const savedHandler = internal._actionHandler;
    internal._actionHandler = null;
    // Install a new action that calls the original _actionHandler with the
    // processedArgs array, exactly as Commander would.
    originalAction(async (...fnArgs: unknown[]) => {
      warn();
      // fnArgs = (opts, command) — reconstruct processedArgs by dropping the
      // trailing Command instance that Commander appends.
      const processedArgs = fnArgs.slice(0, -1);
      await savedHandler(processedArgs as unknown[]);
    });
  }

  // Override outputHelp so --help also warns.
  const origOutputHelp = cmd.outputHelp.bind(cmd);
  cmd.outputHelp = ((contextOrFn?: unknown) => {
    warn();
    return origOutputHelp(contextOrFn as Parameters<typeof origOutputHelp>[0]);
  }) as typeof cmd.outputHelp;

  return cmd;
}
