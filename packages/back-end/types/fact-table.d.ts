export type FactType = "number" | "row";

export type FactNumberFormat = "number" | "currency" | "time:seconds" | null;

export interface FactInterface {
  id: string;
  dateCreated: Date;
  dateUpdated: Date;
  name: string;
  description: string;
  type: FactType;
  column: string;
  numberFormat: FactNumberFormat;
  where: string;
}

export interface FactTableInterface {
  organization: string;
  id: string;
  dateCreated: Date;
  dateUpdated: Date;
  name: string;
  description: string;
  owner: string;
  tags: string[];
  projects: string[];
  datasource: string;
  userIdTypes: string[];
  sql: string;
  facts: FactInterface[];
}
