import { QueryLanguage } from "./datasource";

export interface ImpactEstimateInterface {
  id: string;
  organization: string;
  metric: string;
  segment?: string;
  conversionsPerDay: number;
  query: string;
  queryLanguage: QueryLanguage;
  dateCreated: Date;
}
