export type TestStatus = "idle" | "running" | "passed" | "failed";

// Combined result of the read check and, when this connection must confirm
// write access, the write check. Saving waits on "passed".
export function overallTestStatus(
  readStatus: TestStatus,
  writeStatus: TestStatus,
  checksWrite: boolean,
): TestStatus {
  if (readStatus === "running" || writeStatus === "running") return "running";
  if (readStatus === "failed" || writeStatus === "failed") return "failed";
  if (readStatus === "passed" && (!checksWrite || writeStatus === "passed")) {
    return "passed";
  }
  return "idle";
}
