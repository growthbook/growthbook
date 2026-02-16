// Isolated module to avoid circular deps: util->features->sdk-versioning->sdk-payload->util
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Node = [string, any];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NodeHandler = (node: Node, object: any) => void;

/**
 * Recursively traverses the given object and calls onNode on each key/value pair.
 * If onNode modifies the object in place, it walks the new values as they're inserted, updated, or deleted
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const recursiveWalk = (object: any, onNode: NodeHandler): void => {
  if (object === null || typeof object !== "object") {
    return;
  }
  Object.entries(object).forEach((node) => {
    onNode(node as Node, object);
    recursiveWalk(object[node[0]], onNode);
  });
};
