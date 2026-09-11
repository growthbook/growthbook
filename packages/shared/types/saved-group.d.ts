import { z } from "zod";
import type { ConditionInterface } from "@growthbook/growthbook";
import {
  postSavedGroupBodyValidator,
  putSavedGroupBodyValidator,
  savedGroupValidator,
  savedGroupTypeValidator,
} from "shared/validators";

export type SavedGroupType = z.infer<typeof savedGroupTypeValidator>;

export type SavedGroupInterface = z.infer<typeof savedGroupValidator>;

export type SavedGroupWithoutValues = Omit<SavedGroupInterface, "values">;

export type SavedGroupForDefinitions = Omit<
  SavedGroupInterface,
  "values" | "condition"
>;

/**
 * @deprecated
 */
export type SavedGroupSource = "inline" | "runtime";

export type LegacySavedGroupInterface = Omit<SavedGroupInterface, "type"> & {
  source?: SavedGroupSource;
  type?: SavedGroupType;
};

export type CreateSavedGroupProps = z.infer<typeof postSavedGroupBodyValidator>;
export type UpdateSavedGroupProps = z.infer<typeof putSavedGroupBodyValidator>;

// The v1 SDK payload representation: a saved group ID mapped to its array of
// values, able to express only an ID list. Superseded by SavedGroupDefinitions
// below, but not deprecated — it is still what connections without the
// savedGroupReferencesV2 capability receive, and what the internal evaluators
// (feature test results, archetypes, prerequisite reduction) consume.
export type SavedGroupsValues = Record<string, (string | number)[]>;

// The savedGroupReferencesV2 representation of a saved group, covering every
// group type. Supersedes the legacy bare array above, which could only ever
// express a list group and is still what connections without the capability
// receive. The `type` discriminator lets a future group kind be added without
// changing the payload shape or the operator that references it.
export type SavedGroupDefinition =
  | { type: "list"; attributeKey: string; values: (string | number)[] }
  | { type: "condition"; condition: ConditionInterface };

export type SavedGroupDefinitions = Record<string, SavedGroupDefinition>;

export type GroupMap = Map<
  string,
  Pick<
    SavedGroupInterface,
    "type" | "condition" | "attributeKey" | "useEmptyListGroup"
  > & {
    values?: (string | number)[];
  }
>;
