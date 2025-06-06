import { TestQueryRow } from "back-end/src/types/Integration";

export interface SavedQueryInterface {
  id: string;
  organization: string;
  dateCreated: Date;
  dateUpdated: Date;
  name: string;
  description?: string;
  sql: string;
  datasourceId: string;
  tags?: string[];
  results?: TestQueryRow[];
  dateLastRan?: Date;
}
