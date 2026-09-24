/**
 * A user-facing error caused by invalid input (removed config keys, removed
 * env vars, unknown option values). The CLI entry point prints its message
 * once, without a stack trace, and exits with code 2.
 */
export class FlakerUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlakerUsageError";
  }
}
