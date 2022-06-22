import { UserRef } from "./user";

export interface SegmentInterface {
  id: string;
  organization: string;
  userRef: UserRef;
  datasource: string;
  userIdType: string;
  name: string;
  sql: string;
  dateCreated: Date;
  dateUpdated: Date;
}
