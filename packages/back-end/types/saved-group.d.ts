import { z } from "zod";
import { SavedGroupInterface, SavedGroupType } from "shared/src/types";
import {
  postSavedGroupBodyValidator,
  putSavedGroupBodyValidator,
} from "../src/routers/saved-group/saved-group.validators";

/**
 * @deprecated
 */
export type SavedGroupSource = "inline" | "runtime";

export type LegacySavedGroupInterface = Omit<
  Omit<SavedGroupInterface, "type">,
  "values"
> & {
  source?: SavedGroupSource;
  type?: SavedGroupType;
  values?: string[];
};

export type CreateSavedGroupProps = z.infer<typeof postSavedGroupBodyValidator>;
export type UpdateSavedGroupProps = z.infer<typeof putSavedGroupBodyValidator>;
