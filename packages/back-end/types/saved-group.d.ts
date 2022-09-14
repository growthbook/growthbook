export interface SavedGroupInterface {
  _id: string;
  organization: string;
  groupName: string;
  owner: string;
  attributeKey: string;
  group: string[];
  dateUpdated: Date;
  dateCreated: Date;
}
