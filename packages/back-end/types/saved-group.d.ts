export type SavedGroupSource = "inline" | "runtime";

export interface SavedGroupInterface {
  id: string;
  organization: string;
  condition: string;
  groupName: string;
  owner: string;
  attributeKey: string;
  source: SavedGroupSource;
  dateUpdated: Date;
  dateCreated: Date;
}

export type GroupMap = Map<
  string,
  {
    condition: string;
    key: string;
    source: SavedGroupSource;
  }
>;
