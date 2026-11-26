import { DagNode } from "shared/validators";
import {
  assertValidDagNodes,
  DagNodeState,
  getDagActions,
} from "back-end/src/services/dags";

const node = (id: string, overrides: Partial<DagNode> = {}): DagNode => ({
  id,
  dependsOn: id === "main" ? [] : ["main"],
  type: "experiment-snapshot",
  targetId: `snp_${id}`,
  previousTargetIds: [],
  maxAttempts: id === "main" ? 1 : 3,
  ...overrides,
});

const actions = (
  states: Record<string, DagNodeState>,
  nodes: DagNode[] = [node("main"), node("a"), node("b")],
) => getDagActions({ nodes }, new Map(Object.entries(states)));

const running: DagNodeState = { status: "running", stalled: false };
const queued: DagNodeState = { status: "queued" };
const success: DagNodeState = { status: "success" };
const error = (retryable = true): DagNodeState => ({
  status: "error",
  retryable,
});

describe("getDagActions", () => {
  it("waits while a dependency is still running", () => {
    expect(actions({ main: running, a: queued, b: queued })).toEqual([]);
  });

  it("starts queued nodes once every dependency succeeded", () => {
    expect(actions({ main: success, a: queued, b: running })).toEqual([
      { type: "start", nodeId: "a" },
    ]);
  });

  it("waits for every dependency, not just one", () => {
    const nodes = [
      node("main"),
      node("a"),
      node("c", { dependsOn: ["main", "a"] }),
    ];
    expect(actions({ main: success, a: running, c: queued }, nodes)).toEqual(
      [],
    );
    expect(actions({ main: success, a: success, c: queued }, nodes)).toEqual([
      { type: "start", nodeId: "c" },
    ]);
  });

  it("drops queued nodes when a dependency failed for good or is missing", () => {
    const drops = [
      { type: "drop", nodeId: "a" },
      { type: "drop", nodeId: "b" },
    ];
    // The main node has a single attempt, so its failure is final
    expect(actions({ main: error(), a: queued, b: queued })).toEqual(drops);
    expect(actions({ a: queued, b: queued })).toEqual(drops);
  });

  it("does not drop a node whose failed dependency will be retried", () => {
    const nodes = [node("main"), node("a"), node("c", { dependsOn: ["a"] })];
    expect(actions({ main: success, a: error(), c: queued }, nodes)).toEqual([
      { type: "retry", nodeId: "a" },
    ]);
  });

  it("retries a failed node until its attempts run out", () => {
    const secondAttempt = node("a", { previousTargetIds: ["snp_1"] });
    const lastAttempt = node("a", { previousTargetIds: ["snp_1", "snp_2"] });

    expect(
      actions({ main: success, a: error() }, [node("main"), secondAttempt]),
    ).toEqual([{ type: "retry", nodeId: "a" }]);
    expect(
      actions({ main: success, a: error() }, [node("main"), lastAttempt]),
    ).toEqual([{ type: "done" }]);
  });

  it("does not retry a non-retryable failure or a missing node", () => {
    expect(actions({ main: success, a: error(false), b: success })).toEqual([
      { type: "done" },
    ]);
    expect(actions({ main: success, b: success })).toEqual([{ type: "done" }]);
  });

  it("fails a stalled run, whether its creator or the DAG started it", () => {
    const stalled: DagNodeState = { status: "running", stalled: true };
    expect(actions({ main: stalled, a: queued, b: queued })).toEqual([
      { type: "fail-stalled", nodeId: "main" },
    ]);
    expect(actions({ main: success, a: stalled, b: running })).toEqual([
      { type: "fail-stalled", nodeId: "a" },
    ]);
    // A retried node without dependencies, which the DAG started
    const retried = node("main", { maxAttempts: 3, previousTargetIds: ["x"] });
    expect(actions({ main: stalled }, [retried])).toEqual([
      { type: "fail-stalled", nodeId: "main" },
    ]);
  });

  it("is done only when every node is finished", () => {
    expect(actions({ main: success, a: success, b: running })).toEqual([]);
    expect(actions({ main: success, a: success, b: success })).toEqual([
      { type: "done" },
    ]);
    expect(actions({ main: success }, [node("main")])).toEqual([
      { type: "done" },
    ]);
  });
});

describe("assertValidDagNodes", () => {
  it("accepts a chain and a diamond", () => {
    expect(() =>
      assertValidDagNodes([
        node("main"),
        node("a"),
        node("b", { dependsOn: ["main", "a"] }),
      ]),
    ).not.toThrow();
    expect(() => assertValidDagNodes([])).not.toThrow();
  });

  it("rejects duplicate node IDs", () => {
    expect(() =>
      assertValidDagNodes([node("main"), node("a"), node("a")]),
    ).toThrow("unique");
  });

  it("rejects a dependency that is not a node of the DAG", () => {
    expect(() => assertValidDagNodes([node("a")])).toThrow("same DAG");
  });

  it("rejects a node that depends on itself, directly or through others", () => {
    expect(() =>
      assertValidDagNodes([node("a", { dependsOn: ["a"] })]),
    ).toThrow("cycle");
    expect(() =>
      assertValidDagNodes([
        node("main"),
        node("a", { dependsOn: ["main", "b"] }),
        node("b", { dependsOn: ["a"] }),
      ]),
    ).toThrow("cycle");
  });
});
