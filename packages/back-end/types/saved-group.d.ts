export interface SavedGroupInterface {
  id: string;
  orgId: string;
  groupName: string;
  owner: string;
  attributeKey: string;
  values: string[];
  dateUpdated: Date;
  dateCreated: Date;
}
