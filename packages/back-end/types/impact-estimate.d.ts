import { QueryLanguage } from "./datasource";

export interface ImpactEstimateInterface {
  id: string;
  organization: string;
  metric: string;
  segment?: string;
  metricTotal: number;
  value: number;
  query: string;
  queryLanguage: QueryLanguage;
  dateCreated: Date;
}
