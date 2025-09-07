import { createHmac } from "crypto";
import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
import {
  FeatureEnvironment,
  FeatureRule,
} from "back-end/src/validators/features";
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

interface ArrayChanges {
  added?: Record<string, unknown>[];
  removed?: Record<string, unknown>[];
  modified?: Array<{
    id: string;
    oldValue: unknown;
    newValue: unknown;
  }>;
}

interface HierarchicalValue {
  key: string;
  changes?: ArrayChanges;
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

// Define key type for FeatureRule to allow indexing
type KeyofFeatureRule = keyof FeatureRule;

interface RuleFieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

interface RuleChange {
  id: string;
  newValue: FeatureRule;
  fieldChanges: RuleFieldChange[];
}

interface RuleChanges {
  added?: FeatureRule[];
  removed?: FeatureRule[];
  modified?: RuleChange[];
}

interface NestedObjectConfig {
  key: string;
  idField: string;
  ignoredKeys?: string[];
}

interface EnvironmentChanges {
  added?: Record<string, unknown>;
  removed?: Record<string, unknown>;
  modified?: ModificationItem[];
  rules?: RuleChanges;
}

function getRuleFieldChanges(
  oldRule: FeatureRule,
  newRule: FeatureRule,
): RuleFieldChange[] {
  const fieldChanges: RuleFieldChange[] = [];
  const allKeys = new Set([...Object.keys(oldRule), ...Object.keys(newRule)]);

  allKeys.forEach((key) => {
    const typedKey = key as keyof FeatureRule;
    if (!isEqual(oldRule[typedKey], newRule[typedKey])) {
      fieldChanges.push({
        field: key,
        oldValue: oldRule[typedKey],
        newValue: newRule[typedKey],
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

      // Special handling for environment settings or other nested objects with IDs
      if (
        nestedConfig &&
        typeof prev[key] === "object" &&
        prev[key] !== null &&
        typeof curr[key] === "object" &&
        curr[key] !== null
      ) {
        // Process nested objects if they're records (like environmentSettings)
        if (!Array.isArray(prev[key]) && !Array.isArray(curr[key])) {
          const prevEnvs = prev[key] as Record<string, FeatureEnvironment>;
          const currEnvs = curr[key] as Record<string, FeatureEnvironment>;

          // Process each environment
          const allEnvs = new Set([
            ...Object.keys(prevEnvs),
            ...Object.keys(currEnvs),
          ]);
          const envChanges: Record<string, EnvironmentChanges> = {};

          allEnvs.forEach((envName) => {
            if (!prevEnvs[envName]) {
              // Added environment
              envChanges[envName] = {
                added: currEnvs[envName] as unknown as Record<string, unknown>,
              };
            } else if (!currEnvs[envName]) {
              // Removed environment
              envChanges[envName] = {
                removed: prevEnvs[envName] as unknown as Record<
                  string,
                  unknown
                >,
              };
            } else if (!isEqual(prevEnvs[envName], currEnvs[envName])) {
              // Modified environment

              // Check for rules changes, handle them specially
              if (
                Array.isArray(prevEnvs[envName].rules) &&
                Array.isArray(currEnvs[envName].rules)
              ) {
                const prevRules = prevEnvs[envName].rules;
                const currRules = currEnvs[envName].rules;
                const idField = nestedConfig.idField;

                // Track changes by rule ID
                const prevRulesMap = new Map(
                  prevRules.map((r) => [
                    r[idField as KeyofFeatureRule] as string,
                    r,
                  ]),
                );
                const currRulesMap = new Map(
                  currRules.map((r) => [
                    r[idField as KeyofFeatureRule] as string,
                    r,
                  ]),
                );

                const addedRules: FeatureRule[] = [];
                const removedRules: FeatureRule[] = [];
                const modifiedRules: RuleChange[] = [];

                // Find added rules
                currRules.forEach((rule) => {
                  const ruleId = rule[idField as KeyofFeatureRule] as string;
                  if (!prevRulesMap.has(ruleId)) {
                    addedRules.push(rule);
                  }
                });

                // Find removed rules
                prevRules.forEach((rule) => {
                  const ruleId = rule[idField as KeyofFeatureRule] as string;
                  if (!currRulesMap.has(ruleId)) {
                    removedRules.push(rule);
                  }
                });

                // Find modified rules
                currRules.forEach((currRule) => {
                  const currRuleId = currRule[
                    idField as KeyofFeatureRule
                  ] as string;
                  const prevRule = prevRulesMap.get(currRuleId);
                  if (prevRule && !isEqual(prevRule, currRule)) {
                    const fieldChanges = getRuleFieldChanges(
                      prevRule,
                      currRule,
                    );
                    modifiedRules.push({
                      id: currRuleId,
                      newValue: currRule,
                      fieldChanges,
                    });
                  }
                });

                const rulesChanges: RuleChanges = {
                  added: undefined,
                  removed: undefined,
                  modified: undefined,
                };

                if (addedRules.length > 0) rulesChanges.added = addedRules;
                if (removedRules.length > 0)
                  rulesChanges.removed = removedRules;
                if (modifiedRules.length > 0)
                  rulesChanges.modified = modifiedRules;

                // Only include rules if something changed
                if (Object.keys(rulesChanges).length > 0) {
                  // Get other changes in the environment
                  const otherPrevEnvProps = omit(prevEnvs[envName], ["rules"]);
                  const otherCurrEnvProps = omit(currEnvs[envName], ["rules"]);

                  const otherChanges = getObjectDiff(
                    otherPrevEnvProps,
                    otherCurrEnvProps,
                    nestedConfig.ignoredKeys || [],
                  );

                  envChanges[envName] = {
                    rules: rulesChanges,
                    ...otherChanges,
                  };
                }
              } else {
                // Handle non-rule environment changes
                envChanges[envName] = getObjectDiff(
                  prevEnvs[envName],
                  currEnvs[envName],
                  nestedConfig.ignoredKeys || [],
                );
              }
            }
          });

          if (Object.keys(envChanges).length > 0) {
            const hierarchicalValues: HierarchicalValue[] = Object.entries(
              envChanges,
            ).map(([envName, changes]) => {
              const envResult: HierarchicalValue = {
                key: envName,
                added: changes.added || {},
                removed: changes.removed || {},
                modified: changes.modified || [],
              };

              if (changes.rules) {
                const rulesEntry: HierarchicalValue = {
                  key: "rules",
                  changes: changes.rules,
                };
                envResult.values = [rulesEntry];
              }

              return envResult;
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
          // This could be enhanced to handle arrays of objects with IDs too
          const simpleMod: SimpleModification = {
            key,
            oldValue: prev[key],
            newValue: curr[key],
          };
          result.modified.push(simpleMod);
        }
      } else {
        // Default behavior for regular key changes
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
            if (value.changes.modified?.length) {
              const modifiedItems = value.changes.modified.map((change) => {
                // Check if this is a RuleChange with fieldChanges
                if ("fieldChanges" in change && change.fieldChanges) {
                  return {
                    id: change.id,
                    fieldChanges: change.fieldChanges.map((fc) => ({
                      field: fc.field,
                      oldValue: fc.oldValue,
                      newValue: fc.newValue,
                    })),
                  };
                }
                // Fallback to old format if no fieldChanges
                return {
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
              });
              sections.push(`*Modified:* ${JSON.stringify(modifiedItems)}`);
            }
          }

          // Recurse into nested values
          if (value.values && value.values.length > 0) {
            sections.push(formatHierarchicalChanges(value.values));
          }
        });

        return sections.join("\n");
      };

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${mod.key}*\n${formatHierarchicalChanges(mod.values)}`,
        },
      });
    }
  });

  return {
    text: "Changes detected",
    blocks,
  };
}
