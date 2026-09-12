import type { ConditionInterface } from "@growthbook/growthbook";
import {
  GroupMap,
  SavedGroupInterface,
  SavedGroupPayloadMap,
  SavedGroupsValues,
} from "shared/types/saved-group";
import { NodeHandler } from "../../util";

/**
 * The three ways saved groups can be written into an SDK payload.
 *
 * - `inline`: put each group's values straight into the conditions, using
 *   `$in` and `$nin`. The payload has no `savedGroups` field. For SDKs that
 *   cannot look up a reference at all.
 * - `referencesV1`: ID list groups become `$inGroup` or `$notInGroup`, looked
 *   up in a map of plain value arrays. Condition groups have no reference form
 *   here, so their conditions still go inline.
 * - `referencesV2`: every group becomes a `$savedGroup` reference, looked up in
 *   a map of typed entries.
 */
export type SavedGroupRendering = "inline" | "referencesV1" | "referencesV2";

/**
 * Everything a payload build does with saved groups. The group map,
 * organization and capabilities are already bound, so callers just call
 * methods.
 *
 * Build one per payload with `getSavedGroupPayloadStrategy` and pass it down.
 * That way the format is chosen once, and the conditions and the `savedGroups`
 * field cannot end up disagreeing.
 *
 * There is one implementation per rendering. The two older ones are frozen. We
 * cannot upgrade SDKs that are already out there, so `inline` and
 * `referencesV1` should not need to change again. A new format means a new
 * implementation, and nothing else changes.
 */
export interface SavedGroupPayloadStrategy {
  /** Which format this strategy writes. */
  readonly rendering: SavedGroupRendering;

  /**
   * The group map the methods below use. Read it from here instead of passing
   * a second map, so the two can never disagree.
   */
  readonly groupMap: GroupMap;

  /**
   * Builds the condition for one saved group. Returns null if the group is
   * missing or unusable. For example, a list group with `include: true` might
   * come out as:
   *
   *   referencesV1  ->  {"id": {"$inGroup": "grp_beta"}}
   *   referencesV2  ->  {"$savedGroup": "grp_beta"}
   *
   * `include: false` negates whatever form is used.
   */
  createCondition(args: {
    groupId: string;
    // Whether the user must be in the group (true) or out of it (false)
    include: boolean;
  }): ConditionInterface | null;

  /**
   * Returns the handler that rewrites the `$savedGroups` operator wherever it
   * shows up in a stored condition. For example, `{"$savedGroups":
   * ["grp_beta"]}` might become:
   *
   *   referencesV1  ->  {"id": {"$inGroup": "grp_beta"}}
   *   referencesV2  ->  {"$savedGroup": "grp_beta"}
   */
  createSavedGroupsOperatorHandler(): NodeHandler;

  /**
   * Changes a finished condition in place. Always safe to call. If there is
   * nothing to do, the condition is left alone. For example, one kind of
   * finalizing swaps each group reference for that group's values:
   *
   *   {"id": {"$inGroup": "grp_beta"}}  ->  {"id": {"$in": ["1", "2"]}}
   */
  finalizeCondition(condition: unknown): void;

  /**
   * Builds the payload's `savedGroups` field, in the shape that matches the
   * operators the other methods wrote. For example:
   *
   *   referencesV1  ->  {"grp_beta": ["1", "2"]}
   *   referencesV2  ->  {"grp_beta": {"type": "list",
   *                                   "attributeKey": "id",
   *                                   "values": ["1", "2"]}}
   *
   * Returns undefined if the conditions already carry the values, since then
   * there is nothing to look up.
   */
  buildSavedGroupsPayload(
    usedSavedGroups: SavedGroupInterface[],
  ): SavedGroupsValues | SavedGroupPayloadMap | undefined;
}
