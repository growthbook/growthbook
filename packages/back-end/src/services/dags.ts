import { DagInterface, DagNode } from "shared/validators";

export type DagNodeState =
  | { status: "missing" | "queued" | "success" }
  // stalled: started, but nothing recorded for 10 minutes
  | { status: "running"; stalled: boolean }
  | { status: "error"; retryable: boolean };

export type DagAction =
  | { type: "start" | "drop" | "retry" | "fail-unstarted"; nodeId: string }
  | { type: "done" };

/**
 * What a DAG needs done next, given the state of each node's current attempt
 * (keyed by node ID; a node with no state is treated as missing).
 */
export function getDagActions(
  dag: Pick<DagInterface, "nodes">,
  states: Map<string, DagNodeState>,
): DagAction[] {
  const stateOf = (nodeId: string): DagNodeState =>
    states.get(nodeId) ?? { status: "missing" };
  const nodesById = new Map(dag.nodes.map((node) => [node.id, node]));

  const canRetry = (node: DagNode): boolean => {
    const state = stateOf(node.id);
    return (
      state.status === "error" &&
      state.retryable &&
      node.previousTargetIds.length + 1 < node.maxAttempts
    );
  };
  // A node is finished once nothing more will happen to it
  const isFinished = (nodeId: string): boolean => {
    const node = nodesById.get(nodeId);
    if (!node) return true;
    const { status } = stateOf(nodeId);
    return (
      status === "success" ||
      status === "missing" ||
      (status === "error" && !canRetry(node))
    );
  };

  const actions: DagAction[] = [];
  for (const node of dag.nodes) {
    const state = stateOf(node.id);
    if (state.status === "queued") {
      const succeeded = (id: string) => stateOf(id).status === "success";
      if (node.dependsOn.every(succeeded)) {
        actions.push({ type: "start", nodeId: node.id });
      } else if (
        node.dependsOn.some((id) => isFinished(id) && !succeeded(id))
      ) {
        // A dependency ended without succeeding, so this can never start
        actions.push({ type: "drop", nodeId: node.id });
      }
    } else if (state.status === "error" && canRetry(node)) {
      actions.push({ type: "retry", nodeId: node.id });
    } else if (
      state.status === "running" &&
      state.stalled &&
      // A node without dependencies was started by its creator, not the DAG
      node.dependsOn.length > 0
    ) {
      actions.push({ type: "fail-unstarted", nodeId: node.id });
    }
  }

  if (dag.nodes.every((node) => isFinished(node.id))) {
    actions.push({ type: "done" });
  }
  return actions;
}
