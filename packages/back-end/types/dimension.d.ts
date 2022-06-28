import { UserRef } from "./user";

export interface DimensionInterface {
  id: string;
  organization: string;
  owner: UserRef;
  datasource: string;
  userIdType: string;
  name: string;
  sql: string;
  dateCreated: Date | null;
  dateUpdated: Date | null;
}
