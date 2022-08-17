export interface DimensionInterface {
  id: string;
  organization: string;
  owner: string;
  datasource: string;
  userIdType: string;
  name: string;
  sql: string;
  dateCreated: Date | null;
  dateUpdated: Date | null;
}
