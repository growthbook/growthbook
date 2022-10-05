export interface SavedGroupInterface {
  id: string;
  organization: string;
  groupName: string;
  owner: string;
  attributeKey: string;
  values: string[];
  dateUpdated: Date;
  dateCreated: Date;
}
