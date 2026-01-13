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
  description?: string;
  projects?: string[];
  useEmptyListGroup?: boolean;
}
export type SavedGroupType = "condition" | "list";

// Omit large values array for performance on the front-end
export type SavedGroupWithoutValues = Omit<SavedGroupInterface, "values">;
