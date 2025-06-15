import { z } from "zod/v4";
import { SavedGroupInterface, SavedGroupType } from "shared/src/types";
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
