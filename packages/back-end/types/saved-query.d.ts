import { TestQueryRow } from "back-end/src/types/Integration";

export interface SavedQueryInterface {
  id: string;
  organization: string;
  owner?: string;
  datasourceId: string;
  dateCreated: Date;
  dateUpdated: Date;
  name: string;
  description?: string;
  sql: string;
  results?: TestQueryRow[];
  dateLastRan?: Date;
}
