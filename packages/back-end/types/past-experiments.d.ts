import { Queries } from "./query";

export interface PastExperiment {
  trackingKey: string;
  numVariations: number;
  variationKeys: string[];
  weights: number[];
  users: number;
  startDate: Date;
  endDate: Date;
}

export interface PastExperimentsInterface {
  id: string;
  organization: string;
  datasource: string;
  experiments?: PastExperiment[];
  runStarted: Date | null;
  queries: Queries;
  error?: string;
  dateCreated: Date;
  dateUpdated: Date;
}
