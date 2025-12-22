import { z } from "zod";
import {
  postSavedGroupBodyValidator,
  putSavedGroupBodyValidator,
} from "shared/validators";
import { SavedGroupInterface, SavedGroupType } from "shared/types/groups";

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
