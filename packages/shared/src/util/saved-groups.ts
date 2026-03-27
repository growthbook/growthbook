import { isEqual } from "lodash";
import {
  SDKAttributeType,
  OrganizationInterface,
  SDKAttribute,
} from "shared/types/organization";
import { AttributeMap } from "shared/types/feature";
import {
  GroupMap,
  SavedGroupsValues,
  SavedGroupInterface,
} from "shared/types/saved-group";

function getTimestamp(date: Date | string): number {
  if (typeof date === "string") {
    return new Date(date).getTime();
  }
  return date.getTime();
}

export const SAVED_GROUP_SIZE_LIMIT_BYTES = 1024 * 1024;
export const SMALL_GROUP_SIZE_LIMIT = 100;
export const ID_LIST_DATATYPES: SDKAttributeType[] = [
  "number",
  "string",
  "secureString",
] as const;
export function isIdListSupportedAttribute(
  attribute?: Pick<SDKAttribute, "datatype" | "disableEqualityConditions">,
): boolean {
  if (attribute?.disableEqualityConditions) return false;
  const datatype = attribute?.datatype;
  return !!datatype && ID_LIST_DATATYPES.includes(datatype);
}

export function getSavedGroupsValuesFromGroupMap(
  groupMap: GroupMap,
): SavedGroupsValues {
  return Object.fromEntries(
    Array.from(groupMap.entries())
      .filter(
        ([_id, groupMapVal]) =>
          groupMapVal.type === "list" && groupMapVal.values !== undefined,
      )
      .map(([id, groupMapVal]) => [id, groupMapVal.values]),
    // TODO: maybe fix type inference
  ) as SavedGroupsValues;
}

export function getSavedGroupsValuesFromInterfaces(
  savedGroups: SavedGroupInterface[],
  organization: OrganizationInterface,
): SavedGroupsValues {
  return Object.fromEntries(
    savedGroups
      .filter(
        (savedGroup) =>
          savedGroup.type === "list" && savedGroup.values !== undefined,
      )
      .map((savedGroup) => {
        const values = getTypedSavedGroupValues(
          savedGroup.values || [],
          getSavedGroupValueType(savedGroup, organization),
        );
        return [savedGroup.id, values];
      }),
    // TODO: maybe fix type inference
  ) as SavedGroupsValues;
}

export function getTypedSavedGroupValues(
  values: string[],
  type?: string,
): string[] | number[] {
  if (type === "number") {
    return values.map((v) => parseFloat(v));
  }
  return values;
}

export function getSavedGroupValueType(
  group: SavedGroupInterface,
  organization: Pick<OrganizationInterface, "settings">,
): string {
  const attributes = organization.settings?.attributeSchema;

  const attributeMap: AttributeMap = new Map();
  attributes?.forEach((attribute) => {
    attributeMap.set(attribute.property, attribute.datatype);
  });

  if (group.type === "list" && group.attributeKey && group.values) {
    const attributeType = attributeMap?.get(group.attributeKey);
    return attributeType || "";
  }

  return "";
}

export type SavedGroupMergeStrategy = "" | "overwrite" | "discard";

export interface SavedGroupMergeConflict {
  name: string;
  key: string;
  resolved: boolean;
  base: string;
  live: string;
  revision: string;
}

export type SavedGroupMergeResult = {
  condition?: string;
  values?: string[];
  groupName?: string;
  owner?: string;
  description?: string;
  projects?: string[];
  archived?: boolean;
};

export type SavedGroupAutoMergeResult =
  | {
      success: true;
      conflicts: SavedGroupMergeConflict[];
      result: SavedGroupMergeResult;
    }
  | {
      success: false;
      conflicts: SavedGroupMergeConflict[];
    };

/**
 * Automatically merge changes for a saved group draft, detecting conflicts.
 *
 * This performs a three-way merge between:
 * - base: The state when the draft was created
 * - live: The current live state
 * - proposedChanges: The changes in the draft
 *
 * Conflicts occur when both the draft and live state changed the same field
 * differently from the base. Strategies can resolve conflicts:
 * - "overwrite": Use the draft's value
 * - "discard": Use the live value
 * - "": Unresolved conflict
 *
 * Used by the generic FixConflictsModal in the frontend.
 */
export function autoMergeSavedGroup(
  live: SavedGroupInterface,
  base: SavedGroupInterface,
  revision: SavedGroupInterface,
  proposedChanges: Partial<SavedGroupInterface>,
  strategies: Record<string, SavedGroupMergeStrategy>,
): SavedGroupAutoMergeResult {
  const result: SavedGroupMergeResult = {};
  const diverged =
    getTimestamp(live.dateUpdated) !== getTimestamp(base.dateUpdated);

  // No divergence path: only include changes from proposedChanges
  if (!diverged) {
    if (proposedChanges.condition !== undefined) {
      result.condition = proposedChanges.condition;
    }
    if (proposedChanges.values !== undefined) {
      result.values = proposedChanges.values;
    }
    if (proposedChanges.groupName !== undefined) {
      result.groupName = proposedChanges.groupName;
    }
    if (proposedChanges.owner !== undefined) {
      result.owner = proposedChanges.owner;
    }
    if (proposedChanges.description !== undefined) {
      result.description = proposedChanges.description;
    }
    if (proposedChanges.projects !== undefined) {
      result.projects = proposedChanges.projects;
    }
    if (proposedChanges.archived !== undefined) {
      result.archived = proposedChanges.archived;
    }

    return { success: true, result, conflicts: [] };
  }

  // Diverged path: three-way merge with conflict detection for ALL fields
  const conflicts: SavedGroupMergeConflict[] = [];

  // Helper: add a conflict or auto-apply based on what changed
  function checkConflict<T>(
    key: string,
    name: string,
    baseVal: T,
    liveVal: T,
    proposedVal: T | undefined,
    serialize: (v: T) => string,
    apply: (v: T) => void,
  ) {
    if (proposedVal === undefined) return;
    const proposedChanged = !isEqual(proposedVal, baseVal);
    if (!proposedChanged) return; // draft didn't change this field
    const liveChanged = !isEqual(liveVal, baseVal);
    if (liveChanged && !isEqual(proposedVal, liveVal)) {
      // Both draft and live changed the same field to different values → conflict
      const conflictInfo: SavedGroupMergeConflict = {
        name,
        key,
        base: serialize(baseVal),
        live: serialize(liveVal),
        revision: serialize(proposedVal),
        resolved: false,
      };
      const strategy = strategies[key];
      if (strategy === "overwrite") {
        conflictInfo.resolved = true;
        apply(proposedVal);
      } else if (strategy === "discard") {
        conflictInfo.resolved = true;
        // keep live value (already in result via live as base)
      }
      conflicts.push(conflictInfo);
    } else {
      // Only draft changed it (or both changed to same value) → safe to apply
      apply(proposedVal);
    }
  }

  checkConflict(
    "condition",
    "Condition",
    base.condition || "",
    live.condition || "",
    proposedChanges.condition,
    (v) => v,
    (v) => {
      result.condition = v;
    },
  );

  checkConflict(
    "values",
    "Values",
    base.values || [],
    live.values || [],
    proposedChanges.values,
    (v) => JSON.stringify(v, null, 2),
    (v) => {
      result.values = v;
    },
  );

  checkConflict(
    "groupName",
    "Name",
    base.groupName || "",
    live.groupName || "",
    proposedChanges.groupName,
    (v) => v,
    (v) => {
      result.groupName = v;
    },
  );

  checkConflict(
    "owner",
    "Owner",
    base.owner || "",
    live.owner || "",
    proposedChanges.owner,
    (v) => v,
    (v) => {
      result.owner = v;
    },
  );

  checkConflict(
    "description",
    "Description",
    base.description || "",
    live.description || "",
    proposedChanges.description,
    (v) => v,
    (v) => {
      result.description = v;
    },
  );

  checkConflict(
    "projects",
    "Projects",
    base.projects || [],
    live.projects || [],
    proposedChanges.projects,
    (v) => JSON.stringify(v, null, 2),
    (v) => {
      result.projects = v;
    },
  );

  checkConflict(
    "archived",
    "Archived",
    base.archived ?? false,
    live.archived ?? false,
    proposedChanges.archived,
    (v) => String(v),
    (v) => {
      result.archived = v;
    },
  );

  const success = conflicts.every((c) => c.resolved);
  return success
    ? { success: true, result, conflicts }
    : { success: false, conflicts };
}

export function savedGroupMergeResultHasChanges(
  result: SavedGroupAutoMergeResult,
): boolean {
  if (!result.success) return false;
  return Object.keys(result.result).length > 0;
}
