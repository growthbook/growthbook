import { createHmac } from "crypto";
import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
import {
  DiffResult,
  HierarchicalModification,
  SimpleModification,
  ItemChange,
  ItemFieldChange,
  ItemChanges,
  ContainerChanges,
  HierarchicalValue,
  NestedObjectConfig,
} from "back-end/types/events/diff";

export type EventWebHookSuccessResult = {
  result: "success";
  responseBody: string;
  statusCode: number;
};

export type EventWebHookErrorResult = {
  result: "error";
  statusCode: number | null;
  error: string;
};

export type EventWebHookResult =
  | EventWebHookErrorResult
  | EventWebHookSuccessResult;

// region Web hook signing

/**
 * Given a signing key and a JSON serializable payload, serializes the payload and returns a web hook signature.
 * @param signingKey
 * @param payload
 */
export const getEventWebHookSignatureForPayload = <T>({
  signingKey,
  payload,
}: {
  signingKey: string;
  payload: T;
}): string => {
  const requestPayload = JSON.stringify(payload);

  return createHmac("sha256", signingKey).update(requestPayload).digest("hex");
};

// endregion Web hook signing

// region Diff generation
function getItemFieldChanges(
  oldItem: Record<string, unknown>,
  newItem: Record<string, unknown>,
  ignoredKeys: string[] = [],
): ItemFieldChange[] {
  const fieldChanges: ItemFieldChange[] = [];
  const allKeys = new Set([...Object.keys(oldItem), ...Object.keys(newItem)]);

  allKeys.forEach((key) => {
    if (!ignoredKeys.includes(key) && !isEqual(oldItem[key], newItem[key])) {
      fieldChanges.push({
        field: key,
        oldValue: oldItem[key],
        newValue: newItem[key],
      });
    }
  });

  return fieldChanges;
}

export interface GetObjectDiffOptions {
  ignoredKeys?: string[];
  nestedObjectConfigs?: NestedObjectConfig[];
  maxDepth?: number;
}

export function getObjectDiff(
  prev: Record<string, unknown>,
  curr: Record<string, unknown>,
  options: GetObjectDiffOptions = {},
): DiffResult {
  const { ignoredKeys = [], nestedObjectConfigs = [], maxDepth = 10 } = options;
  // Check recursion depth limit
  if (maxDepth <= 0) {
    return {
      added: {},
      removed: {},
      modified: [
        {
          key: "[recursion limit reached]",
          oldValue: "",
          newValue: "",
        },
      ],
    };
  }

  const result: DiffResult = {
    added: {},
    removed: {},
    modified: [],
  };

  const nestedConfigMap = new Map(
    nestedObjectConfigs.map((config) => [config.key, config]),
  );

  // Handle added keys
  Object.keys(curr).forEach((key) => {
    if (ignoredKeys.includes(key)) return;

    if (!(key in prev)) {
      result.added[key] = curr[key];
    } else if (!isEqual(prev[key], curr[key])) {
      const nestedConfig = nestedConfigMap.get(key);

      // Special handling for nested objects with IDs
      if (
        nestedConfig &&
        typeof prev[key] === "object" &&
        prev[key] !== null &&
        typeof curr[key] === "object" &&
        curr[key] !== null
      ) {
        // Process nested objects if they're records (like containers)
        if (!Array.isArray(prev[key]) && !Array.isArray(curr[key])) {
          const prevContainers = prev[key] as Record<string, unknown>;
          const currContainers = curr[key] as Record<string, unknown>;

          // Process each container
          const allContainers = new Set([
            ...Object.keys(prevContainers),
            ...Object.keys(currContainers),
          ]);
          const containerChanges: Record<string, ContainerChanges> = {};

          allContainers.forEach((containerName) => {
            if (!prevContainers[containerName]) {
              // Added container
              containerChanges[containerName] = {
                added: currContainers[containerName] as Record<string, unknown>,
              };
            } else if (!currContainers[containerName]) {
              // Removed container
              containerChanges[containerName] = {
                removed: prevContainers[containerName] as Record<
                  string,
                  unknown
                >,
              };
            } else if (
              !isEqual(
                prevContainers[containerName],
                currContainers[containerName],
              )
            ) {
              // Modified container

              const prevContainer = prevContainers[containerName] as Record<
                string,
                unknown
              >;
              const currContainer = currContainers[containerName] as Record<
                string,
                unknown
              >;

              // Check for array field changes, handle them specially if configured
              if (
                nestedConfig?.arrayField &&
                Array.isArray(prevContainer[nestedConfig.arrayField]) &&
                Array.isArray(currContainer[nestedConfig.arrayField])
              ) {
                const prevItems = prevContainer[
                  nestedConfig.arrayField
                ] as Record<string, unknown>[];
                const currItems = currContainer[
                  nestedConfig.arrayField
                ] as Record<string, unknown>[];
                const idField = nestedConfig.idField;

                // Track changes by item ID
                const prevItemsMap = new Map(
                  prevItems.map((item) => [
                    item[idField || "id"] as string,
                    item,
                  ]),
                );
                const currItemsMap = new Map(
                  currItems.map((item) => [
                    item[idField || "id"] as string,
                    item,
                  ]),
                );
                const prevIndexMap = new Map<string, number>();
                const currIndexMap = new Map<string, number>();
                prevItems.forEach((item, idx) => {
                  prevIndexMap.set(item[idField || "id"] as string, idx);
                });
                currItems.forEach((item, idx) => {
                  currIndexMap.set(item[idField || "id"] as string, idx);
                });

                const addedItems: Record<string, unknown>[] = [];
                const removedItems: Record<string, unknown>[] = [];
                const modifiedItems: ItemChange[] = [];
                const modifiedById = new Map<string, ItemChange>();

                // Find added items
                currItems.forEach((item, index) => {
                  const itemId = item[idField || "id"] as string;
                  if (!prevItemsMap.has(itemId)) {
                    const itemWithIndex = {
                      ...(item as Record<string, unknown>),
                      __index: index,
                    };
                    addedItems.push(itemWithIndex);
                  }
                });

                // Find removed items
                prevItems.forEach((item, index) => {
                  const itemId = item[idField || "id"] as string;
                  if (!currItemsMap.has(itemId)) {
                    const itemWithIndex = {
                      ...(item as Record<string, unknown>),
                      __index: index,
                    };
                    removedItems.push(itemWithIndex);
                  }
                });

                // Find modified items
                currItems.forEach((currItem, index) => {
                  const currItemId = currItem[idField || "id"] as string;
                  const prevItem = prevItemsMap.get(currItemId);
                  if (prevItem && !isEqual(prevItem, currItem)) {
                    const fieldChanges = getItemFieldChanges(
                      prevItem,
                      currItem,
                      nestedConfig?.ignoredKeys || [],
                    );
                    const change: ItemChange = {
                      id: currItemId,
                      newValue: {
                        ...(currItem as Record<string, unknown>),
                        __index: index,
                      },
                      fieldChanges,
                    };
                    modifiedItems.push(change);
                    modifiedById.set(currItemId, change);
                  }
                });

                // Find reordered items (present in both arrays but index changed)
                currItems.forEach((currItem, index) => {
                  const currItemId = currItem[idField || "id"] as string;
                  const prevIdx = prevIndexMap.get(currItemId);
                  const currIdx = currIndexMap.get(currItemId);
                  if (
                    prevIdx !== undefined &&
                    currIdx !== undefined &&
                    prevIdx !== currIdx
                  ) {
                    // Merge reorder info into existing change or create a new one
                    const existing = modifiedById.get(currItemId);
                    if (existing) {
                      existing.oldIndex = prevIdx;
                      existing.newIndex = currIdx;
                      existing.steps = prevIdx - currIdx;
                    } else {
                      const change: ItemChange = {
                        id: currItemId,
                        newValue: {
                          ...(currItem as Record<string, unknown>),
                          __index: index,
                        },
                        oldIndex: prevIdx,
                        newIndex: currIdx,
                        steps: prevIdx - currIdx,
                      };
                      modifiedItems.push(change);
                      modifiedById.set(currItemId, change);
                    }
                  }
                });

                const itemChanges: ItemChanges = {
                  added: undefined,
                  removed: undefined,
                  modified: undefined,
                };

                if (addedItems.length > 0) itemChanges.added = addedItems;
                if (removedItems.length > 0) itemChanges.removed = removedItems;
                // Post-process to build compact summaries for order shifts
                const summaries: NonNullable<ItemChanges["orderSummaries"]> =
                  [];

                // Helper to detect contiguous indices
                const isContiguous = (indices: number[]): boolean => {
                  if (indices.length <= 1) return true;
                  const sorted = [...indices].sort((a, b) => a - b);
                  for (let i = 1; i < sorted.length; i++) {
                    if (sorted[i] !== sorted[i - 1] + 1) return false;
                  }
                  return true;
                };

                // Case 1: Inserts causing bulk shift (support multiple inserts)
                if (addedItems.length > 0) {
                  const consumed = new Set<string>();
                  for (const added of addedItems) {
                    const addedId = (added[idField || "id"] || "") as string;
                    const addedIndex = currIndexMap.get(addedId);
                    if (typeof addedIndex !== "number") continue;
                    const followers = modifiedItems.filter(
                      (m) =>
                        !m.fieldChanges?.length &&
                        typeof m.oldIndex === "number" &&
                        typeof m.newIndex === "number" &&
                        m.steps === -1 &&
                        (m.newIndex as number) >= addedIndex &&
                        !consumed.has(m.id),
                    );
                    const affectedIndices = followers.map(
                      (m) => m.newIndex as number,
                    );
                    if (followers.length > 0 && isContiguous(affectedIndices)) {
                      summaries.push({
                        type: "insertShift",
                        insertIndex: addedIndex,
                        direction: "down",
                        affectedCount: followers.length,
                      });
                      for (const f of followers) {
                        consumed.add(f.id);
                        const idx = modifiedItems.indexOf(f);
                        if (idx >= 0) modifiedItems.splice(idx, 1);
                      }
                    }
                  }
                }

                // Case 2: Deletions causing bulk shift (support multiple deletions)
                if (removedItems.length > 0) {
                  const consumed = new Set<string>();
                  for (const removed of removedItems) {
                    const removedId = (removed[idField || "id"] ||
                      "") as string;
                    const removedIndex = prevIndexMap.get(removedId);
                    if (typeof removedIndex !== "number") continue;
                    const followers = modifiedItems.filter(
                      (m) =>
                        !m.fieldChanges?.length &&
                        typeof m.oldIndex === "number" &&
                        typeof m.newIndex === "number" &&
                        m.steps === 1 &&
                        (m.oldIndex as number) > removedIndex &&
                        !consumed.has(m.id),
                    );
                    const affectedOld = followers.map(
                      (m) => m.oldIndex as number,
                    );
                    if (followers.length > 0 && isContiguous(affectedOld)) {
                      summaries.push({
                        type: "deleteShift",
                        deleteIndex: removedIndex,
                        direction: "up",
                        affectedCount: followers.length,
                      });
                      for (const f of followers) {
                        consumed.add(f.id);
                        const idx = modifiedItems.indexOf(f);
                        if (idx >= 0) modifiedItems.splice(idx, 1);
                      }
                    }
                  }
                }

                // Case 3: Reorders causing bulk shift (support multiple groups)
                if (addedItems.length === 0 && removedItems.length === 0) {
                  const processed = new Set<string>();
                  let reorderOnly = modifiedItems.filter(
                    (m) =>
                      !m.fieldChanges?.length &&
                      typeof m.oldIndex === "number" &&
                      typeof m.newIndex === "number" &&
                      m.oldIndex !== m.newIndex &&
                      !processed.has(m.id),
                  );
                  while (reorderOnly.length > 0) {
                    // Pick the moved item with largest absolute movement
                    let moved = reorderOnly[0];
                    for (const m of reorderOnly) {
                      if (
                        Math.abs((m.steps as number) || 0) >
                        Math.abs((moved.steps as number) || 0)
                      ) {
                        moved = m;
                      }
                    }
                    const direction: "down" | "up" =
                      (moved.steps as number) < 0 ? "down" : "up";
                    const lower = Math.min(
                      moved.oldIndex as number,
                      moved.newIndex as number,
                    );
                    const upper = Math.max(
                      moved.oldIndex as number,
                      moved.newIndex as number,
                    );
                    const expectedFollowerStep =
                      (moved.steps as number) > 0 ? -1 : 1;
                    const followers = reorderOnly.filter((m) => {
                      if (m === moved) return false;
                      const s = (m.steps as number) || 0;
                      const idx = m.newIndex as number;
                      return (
                        s === expectedFollowerStep &&
                        idx >= lower &&
                        idx <= upper
                      );
                    });
                    const followerIndices = followers.map(
                      (m) => m.newIndex as number,
                    );
                    if (followers.length > 0 && isContiguous(followerIndices)) {
                      summaries.push({
                        type: "reorderShift",
                        movedId: moved.id,
                        fromIndex: moved.oldIndex as number,
                        toIndex: moved.newIndex as number,
                        direction,
                        affectedCount: followers.length,
                      });
                      for (const f of followers) {
                        const idx = modifiedItems.indexOf(f);
                        if (idx >= 0) modifiedItems.splice(idx, 1);
                      }
                    } else {
                      // Create summary for standalone moves (no followers)
                      summaries.push({
                        type: "reorderShift",
                        movedId: moved.id,
                        fromIndex: moved.oldIndex as number,
                        toIndex: moved.newIndex as number,
                        direction,
                        affectedCount: 0,
                      });
                    }
                    // Mark the moved item as processed to guarantee progress
                    processed.add(moved.id);
                    // Refresh candidates excluding processed ones
                    reorderOnly = modifiedItems.filter(
                      (m) =>
                        !m.fieldChanges?.length &&
                        typeof m.oldIndex === "number" &&
                        typeof m.newIndex === "number" &&
                        m.oldIndex !== m.newIndex &&
                        !processed.has(m.id),
                    );
                  }
                }

                if (summaries.length > 0)
                  itemChanges.orderSummaries = summaries;
                if (modifiedItems.length > 0)
                  itemChanges.modified = modifiedItems;
                // modifiedItems may include pure reorder entries or field changes or both

                // Only include items if something changed
                if (Object.keys(itemChanges).length > 0) {
                  // Get other changes in the container (excluding the array field)
                  const otherPrevProps = omit(prevContainer, [
                    nestedConfig.arrayField,
                  ]);
                  const otherCurrProps = omit(currContainer, [
                    nestedConfig.arrayField,
                  ]);

                  const otherChanges = getObjectDiff(
                    otherPrevProps,
                    otherCurrProps,
                    {
                      ignoredKeys: nestedConfig?.ignoredKeys || [],
                      maxDepth: maxDepth - 1,
                    },
                  );

                  containerChanges[containerName] = {
                    items: itemChanges,
                    ...otherChanges,
                  };
                }
              } else {
                // Handle non-array container changes
                containerChanges[containerName] = getObjectDiff(
                  prevContainer,
                  currContainer,
                  {
                    ignoredKeys: nestedConfig?.ignoredKeys || [],
                    maxDepth: maxDepth - 1,
                  },
                );
              }
            }
          });

          if (Object.keys(containerChanges).length > 0) {
            const hierarchicalValues: HierarchicalValue[] = Object.entries(
              containerChanges,
            ).map(([containerName, changes]) => {
              const containerResult: HierarchicalValue = {
                key: containerName,
                added: changes.added || {},
                removed: changes.removed || {},
                modified: changes.modified || [],
              };

              if (
                changes.items &&
                ((changes.items.added && changes.items.added.length > 0) ||
                  (changes.items.removed && changes.items.removed.length > 0) ||
                  (changes.items.modified &&
                    changes.items.modified.length > 0) ||
                  (changes.items.orderSummaries &&
                    changes.items.orderSummaries.length > 0))
              ) {
                const itemsEntry: HierarchicalValue = {
                  key: nestedConfig?.arrayField || "items",
                  changes: changes.items,
                };
                containerResult.values = [itemsEntry];
              }

              return containerResult;
            });

            const hierarchicalMod: HierarchicalModification = {
              key,
              added: {},
              removed: {},
              modified: [],
              values: hierarchicalValues,
            };
            result.modified.push(hierarchicalMod);
          }
        } else {
          // Generic array handling for other nested configs
          const simpleMod: SimpleModification = {
            key,
            oldValue: prev[key],
            newValue: curr[key],
          };
          result.modified.push(simpleMod);
        }
      } else if (Array.isArray(prev[key]) && Array.isArray(curr[key])) {
        // Handle arrays automatically - no config needed for arrays of primitives
        const prevArray = prev[key] as unknown[];
        const currArray = curr[key] as unknown[];

        // Check if this is an array of primitives (strings, numbers, booleans)
        const isPrimitiveArray =
          currArray.length > 0 &&
          (typeof currArray[0] === "string" ||
            typeof currArray[0] === "number" ||
            typeof currArray[0] === "boolean");

        if (isPrimitiveArray) {
          // For arrays of primitives, just treat as a simple field change
          // The Slack formatter will handle the display properly
          const simpleMod: SimpleModification = {
            key,
            oldValue: prevArray,
            newValue: currArray,
          };
          result.modified.push(simpleMod);
        } else {
          // For arrays of objects, we need nested config to know the ID field
          // If no config, fall through to simple field change
          const simpleMod: SimpleModification = {
            key,
            oldValue: prevArray,
            newValue: currArray,
          };
          result.modified.push(simpleMod);
        }
      } else if (
        typeof prev[key] === "object" &&
        prev[key] !== null &&
        typeof curr[key] === "object" &&
        curr[key] !== null &&
        !Array.isArray(prev[key]) &&
        !Array.isArray(curr[key])
      ) {
        // Default behavior: handle object field changes by grouping under the parent key
        const prevObj = prev[key] as Record<string, unknown>;
        const currObj = curr[key] as Record<string, unknown>;

        // Use ignoredKeys from nested config if available
        const configIgnoredKeys = nestedConfig?.ignoredKeys || [];

        // Compute a sub-diff relative to this nested object
        const subDiff = getObjectDiff(prevObj, currObj, {
          ignoredKeys: configIgnoredKeys,
          maxDepth: maxDepth - 1,
        });

        // If there are any changes inside, wrap them as a hierarchical modification so
        // sibling field changes are grouped under the parent key (e.g. "revision")
        if (
          Object.keys(subDiff.added).length > 0 ||
          Object.keys(subDiff.removed).length > 0 ||
          subDiff.modified.length > 0
        ) {
          const hierarchicalMod: HierarchicalModification = {
            key,
            added: subDiff.added,
            removed: subDiff.removed,
            modified: subDiff.modified,
            values: [],
          };
          result.modified.push(hierarchicalMod);
        }
      } else {
        // Default behavior for primitive values
        const simpleMod: SimpleModification = {
          key,
          oldValue: prev[key],
          newValue: curr[key],
        };
        result.modified.push(simpleMod);
      }
    }
  });

  // Handle removed keys
  Object.keys(prev).forEach((key) => {
    if (ignoredKeys.includes(key)) return;

    if (!(key in curr)) {
      result.removed[key] = prev[key];
    }
  });

  return result;
}

// endregion Diff generation
