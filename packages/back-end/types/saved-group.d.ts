/**
 * @deprecated
 */
export type SavedGroupSource = "inline" | "runtime";

export interface SavedGroupInterface {
  id: string;
  organization: string;
  condition: string;
  groupName: string;
  owner: string;
  /**
   * @deprecated
   */
  attributeKey?: string;
  dateUpdated: Date;
  dateCreated: Date;
}

export type GroupMap = Map<
  string,
  {
    condition: string;
    key: string;
  }
>;
