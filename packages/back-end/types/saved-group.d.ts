import { z } from "zod";
import {
  postSavedGroupBodyValidator,
  putSavedGroupBodyValidator,
} from "../src/routers/saved-group/saved-group.validators";

/**
 * @deprecated
 */
export type SavedGroupSource = "inline" | "runtime";

export type SavedGroupType = "condition" | "list";

export interface SavedGroupInterface {
  id: string;
  organization: string;
  groupName: string;
  owner: string;
  type: SavedGroupType;
  condition?: string;
  attributeKey?: string;
  values?: string[];
  dateUpdated: Date;
  dateCreated: Date;
}

export type LegacySavedGroupInterface = Omit<SavedGroupInterface, "type"> & {
  source?: SavedGroupSource;
  type?: SavedGroupType;
};

export type GroupMap = Map<
  string,
  Pick<SavedGroupInterface, "type" | "condition" | "attributeKey"> & {
    values?: (string | number)[];
  }
>;
// The data going out in an sdk payload to map from a saved group ID to its array of values
export type IdLists = Record<string, string[] | number[]>;

export type CreateSavedGroupProps = z.infer<typeof postSavedGroupBodyValidator>;
export type UpdateSavedGroupProps = z.infer<typeof putSavedGroupBodyValidator>;
