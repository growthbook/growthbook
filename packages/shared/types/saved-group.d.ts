import { z } from "zod";
import {
  postSavedGroupBodyValidator,
  putSavedGroupBodyValidator,
  savedGroupValidator,
  savedGroupTypeValidator,
} from "shared/validators";

export type SavedGroupType = z.infer<typeof savedGroupTypeValidator>;

export type SavedGroupInterface = z.infer<typeof savedGroupValidator>;

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

// The data going out in an sdk payload to map from a saved group ID to its array of values
export type SavedGroupsValues = Record<string, (string | number)[]>;

export type GroupMap = Map<
  string,
  Pick<
    SavedGroupInterface,
    "type" | "condition" | "attributeKey" | "useEmptyListGroup"
  > & {
    values?: (string | number)[];
  }
>;
