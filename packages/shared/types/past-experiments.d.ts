import { Queries } from "./query";

export interface PastExperiment {
  exposureQueryId: string;
  trackingKey: string;
  experimentName?: string;
  variationNames?: string[];
  numVariations: number;
  variationKeys: string[];
  weights: number[];
  users: number;
  startDate: Date;
  endDate: Date;
  latestData?: Date;
  startOfRange?: boolean;
}

export interface PastExperimentsInterface {
  id: string;
  organization: string;
  datasource: string;
  experiments?: PastExperiment[];
  config?: {
    start: Date;
    end: Date;
  };
  runStarted: Date | null;
  queries: Queries;
  error?: string;
  dateCreated: Date;
  dateUpdated: Date;
  latestData?: Date;
}
