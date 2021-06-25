import { QueryLanguage } from "./datasource";

export interface ImpactEstimateInterface {
  id: string;
  organization: string;
  metric: string;
  regex: string;
  segment?: string;
  metricTotal: number;
  users: number;
  value: number;
  query: string;
  queryLanguage: QueryLanguage;
  dateCreated: Date;
}
