import { Queries } from "./query";

export interface DimensionInterface {
  id: string;
  organization: string;
  managedBy?: "" | "api" | "config";
  owner: string;
  datasource: string;
  description?: string;
  userIdType: string;
  name: string;
  sql: string;
  dateCreated: Date | null;
  dateUpdated: Date | null;
}

export interface DimensionSlicesResult {
  dimension: string;
  dimensionSlices: { name: string; percent: number }[];
}

export interface DimensionSlicesInterface {
  id: string;
  organization: string;

  runStarted: Date;
  queries: Queries;
  error?: string;

  datasource: string;
  exposureQueryId: string;

  results: DimensionSlicesResult[];
}
