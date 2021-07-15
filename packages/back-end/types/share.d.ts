//export type ShareType = "presentation" | "pdf" | "page" | "slack";

export type GraphTypes = "pill" | "violin";

export interface ShareOptions {
  showScreenShots: boolean;
  showGraphs: boolean;
  graphType: GraphTypes;
  hideMetric: string[];
  hideRisk: boolean;
}

export interface ShareInterface {
  id: string;
  userId: string;
  organization: string;
  title: string;
  description: string;
  theme: string;
  customTheme: {
    background: string;
    text: string;
  };
  voting: boolean;
  style: Record<string, string>;
  options?: {
    [id: string]: ShareOptions;
  };
  experimentIds?: string[];
  dateCreated: Date;
  dateUpdated: Date;
}
