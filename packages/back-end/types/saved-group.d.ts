export type SavedGroupSource = "inline" | "runtime";

export interface SavedGroupInterface {
  id: string;
  organization: string;
  groupName: string;
  owner: string;
  attributeKey: string;
  values: string[];
  source: SavedGroupSource;
  dateUpdated: Date;
  dateCreated: Date;
}

export type GroupMap = Map<
  string,
  { values: string[] | number[]; key: string; source: SavedGroupSource }
>;
