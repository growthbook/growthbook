import { z } from "zod";
import type { ConditionInterface } from "@growthbook/growthbook";
import {
  postSavedGroupBodyValidator,
  putSavedGroupBodyValidator,
  savedGroupValidator,
  savedGroupTypeValidator,
} from "shared/validators";

/**
 * Which kind of saved group this is. Today that is "list" or "condition". More
 * kinds could be added later.
 */
export type SavedGroupType = z.infer<typeof savedGroupTypeValidator>;

/**
 * How a saved group is stored in the database. This is not the same shape we
 * send to SDKs.
 */
export type SavedGroupInterface = z.infer<typeof savedGroupValidator>;

/** A stored saved group without its ID list values. */
export type SavedGroupWithoutValues = Omit<SavedGroupInterface, "values">;

/** A stored saved group without its ID list values or its condition string. */
export type SavedGroupForDefinitions = Omit<
  SavedGroupInterface,
  "values" | "condition"
>;

/**
 * @deprecated
 */
export type SavedGroupSource = "inline" | "runtime";

/**
 * The older stored shape, from before `type` existed. It told groups apart by a
 * `source` field. `SavedGroupModel.migrateSavedGroup()` converts these on read.
 */
export type LegacySavedGroupInterface = Omit<SavedGroupInterface, "type"> & {
  source?: SavedGroupSource;
  type?: SavedGroupType;
};

export type CreateSavedGroupProps = z.infer<typeof postSavedGroupBodyValidator>;
export type UpdateSavedGroupProps = z.infer<typeof putSavedGroupBodyValidator>;

/**
 * The v1 payload shape: a saved group ID pointing at its list of values. It can
 * only describe an ID list. SavedGroupPayloadMap below replaces it, but this is
 * not deprecated. SDKs without the savedGroupReferencesV2 capability still get
 * it, and so do the in-app evaluators (feature test results, archetypes, and
 * prerequisite reduction).
 */
export type SavedGroupsValues = Record<string, (string | number)[]>;

/**
 * How one saved group is sent in a savedGroupReferencesV2 payload. Covers every
 * kind of group, not just ID lists. The `type` field means a new kind can be
 * added later without changing the payload shape or the `$savedGroup` operator.
 */
export type SavedGroupPayloadEntry =
  | { type: "list"; attributeKey: string; values: (string | number)[] }
  | { type: "condition"; condition: ConditionInterface };

/** The `savedGroups` field of a savedGroupReferencesV2 payload: ID to entry. */
export type SavedGroupPayloadMap = Record<string, SavedGroupPayloadEntry>;

/**
 * The parts of a stored saved group that condition code actually reads. Named
 * so helpers can take this instead of a whole SavedGroupInterface.
 */
export type SavedGroupForPayload = Pick<
  SavedGroupInterface,
  "type" | "condition" | "attributeKey" | "useEmptyListGroup"
> & {
  values?: (string | number)[];
};

/**
 * Saved group ID to the fields needed to build a targeting condition. Used
 * anywhere conditions are parsed or checked: building payloads, validating
 * writes in the feature REST API, evaluating archetypes, and checks while
 * someone is editing. Not just for SDK payloads.
 */
export type GroupMap = Map<string, SavedGroupForPayload>;
