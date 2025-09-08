import { createHmac } from "crypto";
import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
import { SlackMessage } from "back-end/src/events/handlers/slack/slack-event-handler-utils";

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

interface HierarchicalValue {
  key: string;
  changes?: ItemChanges;
  added?: Record<string, unknown>;
  removed?: Record<string, unknown>;
  modified?: Array<{
    key: string;
    oldValue?: unknown;
    newValue?: unknown;
    values?: HierarchicalValue[];
  }>;
  values?: HierarchicalValue[];
}

interface SimpleModification {
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

interface HierarchicalModification {
  key: string;
  values: HierarchicalValue[];
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  modified: Array<SimpleModification | HierarchicalModification>;
}

type ModificationItem = SimpleModification | HierarchicalModification;

const isSimpleModification = (
  mod: ModificationItem,
): mod is SimpleModification => {
  return "oldValue" in mod && "newValue" in mod;
};

const isHierarchicalModification = (
  mod: ModificationItem,
): mod is HierarchicalModification => {
  return "values" in mod;
};

export interface DiffResult {
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  modified: ModificationItem[];
}

interface ItemFieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

interface ItemChange {
  id: string;
  oldValue?: unknown;
  newValue: unknown;
  fieldChanges?: ItemFieldChange[];
  oldIndex?: number;
  newIndex?: number;
  steps?: number; // positive = moved up, negative = moved down
}

type OrderSummary =
  | {
      type: "insertShift";
      insertIndex: number;
      direction: "down" | "up";
      affectedCount: number;
    }
  | {
      type: "reorderShift";
      movedId: string;
      fromIndex: number;
      toIndex: number;
      direction: "down" | "up";
      affectedCount: number;
    }
  | {
      type: "deleteShift";
      deleteIndex: number;
      direction: "up" | "down";
      affectedCount: number;
    };

interface ItemChanges {
  added?: Record<string, unknown>[];
  removed?: Record<string, unknown>[];
  modified?: ItemChange[];
  orderSummaries?: OrderSummary[];
}

interface NestedObjectConfig {
  key: string;
  idField?: string; // Optional - only needed for array items
  ignoredKeys?: string[];
  arrayField?: string; // Field name that contains array of items to diff
}

interface ContainerChanges {
  added?: Record<string, unknown>;
  removed?: Record<string, unknown>;
  modified?: ModificationItem[];
  items?: ItemChanges;
}

function getItemFieldChanges(
  oldItem: Record<string, unknown>,
  newItem: Record<string, unknown>,
): ItemFieldChange[] {
  const fieldChanges: ItemFieldChange[] = [];
  const allKeys = new Set([...Object.keys(oldItem), ...Object.keys(newItem)]);

  allKeys.forEach((key) => {
    if (!isEqual(oldItem[key], newItem[key])) {
      fieldChanges.push({
        field: key,
        oldValue: oldItem[key],
        newValue: newItem[key],
      });
    }
  });

  return fieldChanges;
}

export function getObjectDiff(
  prev: Record<string, unknown>,
  curr: Record<string, unknown>,
  ignoredKeys: string[] = [],
  nestedObjectConfigs: NestedObjectConfig[] = [],
): DiffResult {
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
                currItems.forEach((item) => {
                  const itemId = item[idField || "id"] as string;
                  if (!prevItemsMap.has(itemId)) {
                    addedItems.push(item as Record<string, unknown>);
                  }
                });

                // Find removed items
                prevItems.forEach((item) => {
                  const itemId = item[idField || "id"] as string;
                  if (!currItemsMap.has(itemId)) {
                    removedItems.push(item as Record<string, unknown>);
                  }
                });

                // Find modified items
                currItems.forEach((currItem) => {
                  const currItemId = currItem[idField || "id"] as string;
                  const prevItem = prevItemsMap.get(currItemId);
                  if (prevItem && !isEqual(prevItem, currItem)) {
                    const fieldChanges = getItemFieldChanges(
                      prevItem,
                      currItem,
                    );
                    const change: ItemChange = {
                      id: currItemId,
                      newValue: currItem,
                      fieldChanges,
                    };
                    modifiedItems.push(change);
                    modifiedById.set(currItemId, change);
                  }
                });

                // Find reordered items (present in both arrays but index changed)
                currItems.forEach((currItem) => {
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
                        newValue: currItem,
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
                  let reorderOnly = modifiedItems.filter(
                    (m) =>
                      !m.fieldChanges?.length &&
                      typeof m.oldIndex === "number" &&
                      typeof m.newIndex === "number" &&
                      m.oldIndex !== m.newIndex,
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
                    }
                    // Remove the moved candidate from consideration and continue
                    reorderOnly = modifiedItems.filter(
                      (m) =>
                        !m.fieldChanges?.length &&
                        typeof m.oldIndex === "number" &&
                        typeof m.newIndex === "number" &&
                        m.oldIndex !== m.newIndex,
                    );
                    // Break if no further grouping is possible
                    const anyGroupable = reorderOnly.some(
                      (m) => Math.abs((m.steps as number) || 0) > 1,
                    );
                    if (!anyGroupable) break;
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
                    nestedConfig?.ignoredKeys || [],
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
                  nestedConfig?.ignoredKeys || [],
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

              if (changes.items) {
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
        const subDiff = getObjectDiff(prevObj, currObj, configIgnoredKeys);

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

export function formatDiffForSlack(diff: DiffResult): SlackMessage {
  const blocks: SlackMessage["blocks"] = [];

  const excludedFields = ["dateUpdated", "version", "__v", "_id"];

  // Added properties
  if (Object.keys(diff.added).length > 0) {
    const cleanedAdded = omit(diff.added, excludedFields);
    if (Object.keys(cleanedAdded).length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Added properties*\n${JSON.stringify(cleanedAdded, null, 2)}`,
        },
      });
    }
  }

  // Removed properties
  if (Object.keys(diff.removed).length > 0) {
    const cleanedRemoved = omit(diff.removed, excludedFields);
    if (Object.keys(cleanedRemoved).length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Removed properties*\n${JSON.stringify(cleanedRemoved, null, 2)}`,
        },
      });
    }
  }

  // Modified properties - one block per key
  diff.modified.forEach((mod: ModificationItem) => {
    if (isSimpleModification(mod)) {
      if (excludedFields.includes(mod.key)) return;

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${mod.key}*\nOld: ${JSON.stringify(mod.oldValue)}\nNew: ${JSON.stringify(mod.newValue)}`,
        },
      });
    } else if (isHierarchicalModification(mod)) {
      if (excludedFields.includes(mod.key)) return;

      const formatHierarchicalChanges = (
        values: HierarchicalValue[],
      ): string => {
        const sections: string[] = [];

        values.forEach((value) => {
          sections.push(`*${value.key}:*`);

          if (value.added && Object.keys(value.added).length > 0) {
            sections.push(
              `Added: ${JSON.stringify(omit(value.added, excludedFields))}`,
            );
          }

          if (value.removed && Object.keys(value.removed).length > 0) {
            sections.push(
              `Removed: ${JSON.stringify(omit(value.removed, excludedFields))}`,
            );
          }

          if (value.modified && value.modified.length > 0) {
            value.modified.forEach((change: ModificationItem) => {
              if (isSimpleModification(change)) {
                sections.push(
                  `Modified ${change.key}: ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)}`,
                );
              }
            });
          }

          // Handle array changes (added/removed/modified items)
          if (value.changes) {
            if (value.changes.added?.length) {
              sections.push(
                `*Added:* ${JSON.stringify(value.changes.added.map((item) => (typeof item === "object" && item !== null ? omit(item, excludedFields) : item)))}`,
              );
            }
            if (value.changes.removed?.length) {
              sections.push(
                `*Removed:* ${JSON.stringify(value.changes.removed.map((item) => (typeof item === "object" && item !== null ? omit(item, excludedFields) : item)))}`,
              );
            }
            if (value.changes.orderSummaries?.length) {
              const summaries = value.changes.orderSummaries.map((s) => {
                switch (s.type) {
                  case "insertShift":
                    return {
                      type: s.type,
                      insertIndex: s.insertIndex,
                      direction: s.direction,
                      affectedCount: s.affectedCount,
                    };
                  case "deleteShift":
                    return {
                      type: s.type,
                      deleteIndex: s.deleteIndex,
                      direction: s.direction,
                      affectedCount: s.affectedCount,
                    };
                  case "reorderShift":
                    return {
                      type: s.type,
                      movedId: s.movedId,
                      fromIndex: s.fromIndex,
                      toIndex: s.toIndex,
                      direction: s.direction,
                      affectedCount: s.affectedCount,
                    };
                }
              });
              sections.push(`*Reorder Summary:* ${JSON.stringify(summaries)}`);
            }
            if (value.changes.modified?.length) {
              const modifiedItems = value.changes.modified.map((change) => {
                // Check if this is an ItemChange with fieldChanges
                if ("fieldChanges" in change && change.fieldChanges) {
                  const entry: Record<string, unknown> = {
                    id: change.id,
                    fieldChanges: (
                      change.fieldChanges as ItemFieldChange[]
                    ).map((fc) => ({
                      field: fc.field,
                      oldValue: fc.oldValue,
                      newValue: fc.newValue,
                    })),
                  };
                  if (
                    typeof change.oldIndex === "number" &&
                    typeof change.newIndex === "number"
                  ) {
                    entry.oldIndex = change.oldIndex;
                    entry.newIndex = change.newIndex;
                    entry.steps = change.steps;
                  }
                  return entry;
                }
                // Fallback to old format if no fieldChanges
                const entry: Record<string, unknown> = {
                  id: change.id,
                  oldValue:
                    typeof change.oldValue === "object" &&
                    change.oldValue !== null
                      ? omit(change.oldValue, excludedFields)
                      : change.oldValue,
                  newValue:
                    typeof change.newValue === "object" &&
                    change.newValue !== null
                      ? omit(change.newValue, excludedFields)
                      : change.newValue,
                };
                if (
                  typeof change.oldIndex === "number" &&
                  typeof change.newIndex === "number"
                ) {
                  entry.oldIndex = change.oldIndex;
                  entry.newIndex = change.newIndex;
                  entry.steps = change.steps;
                }
                return entry;
              });
              sections.push(`*Modified:* ${JSON.stringify(modifiedItems)}`);
            }
            // Reorders are now represented within modified entries via oldIndex/newIndex/steps
          }

          // Recurse into nested values
          if (value.values && value.values.length > 0) {
            sections.push(formatHierarchicalChanges(value.values));
          }
        });

        return sections.join("\n");
      };

      const lines: string[] = [];
      // Include top-level added/removed/modified under this hierarchical key
      if (mod.added && Object.keys(mod.added).length > 0) {
        lines.push(`Added: ${JSON.stringify(omit(mod.added, excludedFields))}`);
      }
      if (mod.removed && Object.keys(mod.removed).length > 0) {
        lines.push(
          `Removed: ${JSON.stringify(omit(mod.removed, excludedFields))}`,
        );
      }
      if (mod.modified && mod.modified.length > 0) {
        mod.modified.forEach((change: ModificationItem) => {
          if (isSimpleModification(change)) {
            lines.push(
              `Modified ${change.key}: ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)}`,
            );
          }
        });
      }
      if (mod.values && mod.values.length > 0) {
        const nested = formatHierarchicalChanges(mod.values);
        if (nested) lines.push(nested);
      }

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${mod.key}*\n${lines.join("\n")}`,
        },
      });
    }
  });

  return {
    text: "Changes detected",
    blocks,
  };
}
