import { DagInterface, DagNode } from "shared/validators";

export type DagNodeState =
  | { status: "missing" | "queued" | "success" }
  // stalled: started, but nothing recorded for 10 minutes
  | { status: "running"; stalled: boolean }
  | { status: "error"; retryable: boolean };

export type DagAction =
  // start: run a queued node whose dependencies all succeeded
  // drop: delete a queued node that can no longer start
  // retry: queue a new attempt of a node that failed
  // fail-stalled: mark a stalled running node as failed
  | { type: "start" | "drop" | "retry" | "fail-stalled"; nodeId: string }
  // done: every node is finished (success or not), so the DAG can be closed
  | { type: "done" };

/**
 * Throws unless node IDs are unique, every dependency is a node of the DAG,
 * and no node depends on itself, directly or through other nodes.
 */
export function assertValidDagNodes(nodes: DagNode[]): void {
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) {
    throw new Error("DAG node IDs must be unique");
  }
  if (nodes.some((node) => node.dependsOn.some((id) => !ids.has(id)))) {
    throw new Error("DAG nodes can only depend on nodes of the same DAG");
  }
  // Resolve nodes whose dependencies are all resolved; a pass that resolves
  // nothing means the rest depend on each other.
  const resolved = new Set<string>();
  while (resolved.size < nodes.length) {
    const ready = nodes.filter(
      (node) =>
        !resolved.has(node.id) &&
        node.dependsOn.every((id) => resolved.has(id)),
    );
    if (!ready.length) {
      throw new Error("DAG nodes cannot depend on each other in a cycle");
    }
    ready.forEach((node) => resolved.add(node.id));
  }
}

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
    } else if (state.status === "running" && state.stalled) {
      // Whoever started it: nothing else ends a run that never got going
      actions.push({ type: "fail-stalled", nodeId: node.id });
    }
  }

  if (dag.nodes.every((node) => isFinished(node.id))) {
    actions.push({ type: "done" });
  }
  return actions;
}
