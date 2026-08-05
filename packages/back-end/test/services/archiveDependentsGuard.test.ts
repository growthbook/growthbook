import { unacknowledgedArchiveDependents } from "back-end/src/services/archiveDependentsGuard";

// The fingerprint is the sorted, deduped set of dependent ids captured at arm
// time; the deferred fire re-checks the LIVE dependents against it. A dependent
// present now but not acknowledged then is NEW (re-contends → terminal); a
// dependent that was acknowledged, or one that went away, never blocks.
describe("unacknowledgedArchiveDependents", () => {
  it("returns only dependents not acknowledged at arm time", () => {
    expect(
      unacknowledgedArchiveDependents(
        ["feature:a", "feature:b", "experiment:c"],
        ["feature:a", "experiment:c"],
      ),
    ).toEqual(["feature:b"]);
  });

  it("re-contends a NEW dependent that appeared between arm and fire", () => {
    // Armed with {a}; at fire time b is also a live dependent → b is new.
    expect(
      unacknowledgedArchiveDependents(["config:a", "config:b"], ["config:a"]),
    ).toEqual(["config:b"]);
  });

  it("does not block when a dependent went away (covered subset)", () => {
    // Armed with {a,b}; at fire time only a remains → nothing new.
    expect(
      unacknowledgedArchiveDependents(["config:a"], ["config:a", "config:b"]),
    ).toEqual([]);
  });

  it("treats all dependents as new when nothing was acknowledged", () => {
    expect(unacknowledgedArchiveDependents(["feature:a"], null)).toEqual([
      "feature:a",
    ]);
    expect(unacknowledgedArchiveDependents(["feature:a"], undefined)).toEqual([
      "feature:a",
    ]);
  });

  it("is order-independent (membership, not sequence)", () => {
    expect(
      unacknowledgedArchiveDependents(
        ["feature:b", "feature:a"],
        ["feature:a", "feature:b"],
      ),
    ).toEqual([]);
  });

  it("distinguishes ids that share a key across namespaces", () => {
    // A config and a constant can share the bare key "x"; the namespaced id
    // keeps them distinct, so acknowledging one doesn't cover the other.
    expect(
      unacknowledgedArchiveDependents(["config:x", "constant:x"], ["config:x"]),
    ).toEqual(["constant:x"]);
  });
});
