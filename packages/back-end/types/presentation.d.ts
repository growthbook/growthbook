//export type ShareType = "presentation" | "pdf" | "page" | "slack";

export type GraphTypes = "pill" | "violin";

export interface PresentationOptions {
  showScreenShots: boolean;
  showGraphs: boolean;
  showInsights: boolean;
  graphType: GraphTypes;
  hideMetric: string[];
  hideRisk: boolean;
}

export interface PresentationExperiment {
  id: string;
  type: string;
  options?: PresentationOptions;
}

export interface PresentationInterface {
  id: string;
  userId: string;
  organization: string;
  title?: string;
  description?: string;
  theme?: string;
  customTheme?: {
    backgroundColor: string;
    textColor: string;
  };
  sharable?: boolean;
  voting?: boolean;
  options?: PresentationOptions;
  experiments: PresentationExperiment[];
  dateCreated: Date;
  dateUpdated: Date;
}
