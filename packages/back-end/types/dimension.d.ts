import { ExperimentDimensionMetadata } from "back-end/types/datasource";
import { Queries } from "./query";

export interface DimensionInterface {
  id: string;
  organization: string;
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

export interface DimensionMapping {
  dimension: string;
  values: {
    name: string;
    compositeValues: string[];
  }[]
}


export interface ExperimentDimensionInterface {
  id: string;
  organization: string;
  exposureQueryId: string;
  exposureQueryName: string;
  identifierType: string;
  datasourceId: string;

  dimension: string;
  dimensionPriority: number;
  
  dimensionSlicesId?: string;
  dimensionValues?: string[];
  dimensionMetadata?: ExperimentDimensionMetadata;
}