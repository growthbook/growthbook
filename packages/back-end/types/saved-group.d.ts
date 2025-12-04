import { z } from "zod";
import { SavedGroupInterface, SavedGroupType } from "shared/types/groups";
import {
  postSavedGroupBodyValidator,
  putSavedGroupBodyValidator,
} from "back-end/src/routers/saved-group/saved-group.validators";

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
