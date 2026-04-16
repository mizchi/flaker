import type {
  TestCaseResult,
  TestFailureLocation,
  TestResultAdapter,
} from "./types.js";
import { resolveTestIdentity } from "../identity.js";

function getAttr(tag: string, attr: string): string | undefined {
  const re = new RegExp(`${attr}="([^"]*)"`, "i");
  const m = tag.match(re);
  return m ? m[1] : undefined;
}

export const junitAdapter: TestResultAdapter = {
  name: "junit",
  parse(input: string): TestCaseResult[] {
    const results: TestCaseResult[] = [];

    // Split by testsuite blocks
    const suiteRe = /<testsuite\s[^>]*>[\s\S]*?<\/testsuite>/g;
    let suiteMatch: RegExpExecArray | null;

    while ((suiteMatch = suiteRe.exec(input)) !== null) {
      const suiteBlock = suiteMatch[0];
      const suiteTag = suiteBlock.match(/<testsuite\s[^>]*>/)?.[0] ?? "";
      const suiteName = getAttr(suiteTag, "name") ?? "unknown";

      // Extract testcase blocks - handle both self-closing and open/close
      const testcaseRe =
        /<testcase\s[^>]*(?:\/>|>[\s\S]*?<\/testcase>)/g;
      let tcMatch: RegExpExecArray | null;

      while ((tcMatch = testcaseRe.exec(suiteBlock)) !== null) {
        const tcBlock = tcMatch[0];
        const tcTag = tcBlock.match(/<testcase\s[^>]*/)?.[0] ?? "";
        const testName = getAttr(tcTag, "name") ?? "unknown";
        const timeStr = getAttr(tcTag, "time") ?? "0";
        const durationMs = Math.round(parseFloat(timeStr) * 1000);
        const file = getAttr(tcTag, "file");
        const line = getAttr(tcTag, "line");

        let status: TestCaseResult["status"] = "passed";
        let errorMessage: string | undefined;
        let stdout: string | undefined;
        let stderr: string | undefined;
        let failureLocation: TestFailureLocation | null = null;

        if (/<failure\s/.test(tcBlock)) {
          status = "failed";
          errorMessage = getAttr(
            tcBlock.match(/<failure\s[^>]*/)?.[0] ?? "",
            "message",
          );
        } else if (/<skipped/.test(tcBlock)) {
          status = "skipped";
        }

        const stdoutMatch = tcBlock.match(/<system-out>([\s\S]*?)<\/system-out>/i);
        const stderrMatch = tcBlock.match(/<system-err>([\s\S]*?)<\/system-err>/i);
        stdout = stdoutMatch?.[1]
          ?.replace(/^<!\[CDATA\[/, "")
          .replace(/\]\]>$/, "")
          .trim();
        stderr = stderrMatch?.[1]
          ?.replace(/^<!\[CDATA\[/, "")
          .replace(/\]\]>$/, "")
          .trim();

        if (file && line) {
          const parsedLine = Number.parseInt(line, 10);
          if (Number.isFinite(parsedLine)) {
            failureLocation = {
              file,
              line: parsedLine,
              column: null,
              functionName: null,
              raw: `${file}:${parsedLine}`,
            };
          }
        }

        const result: TestCaseResult = resolveTestIdentity({
          suite: suiteName,
          testName,
          status,
          durationMs,
          retryCount: 0,
          failureLocation,
          stdout,
          stderr,
        });

        if (errorMessage !== undefined) {
          result.errorMessage = errorMessage;
        }

        results.push(result);
      }
    }

    return results;
  },
};
