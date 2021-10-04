//export type ShareType = "presentation" | "pdf" | "page" | "slack";

export type GraphTypes = "pill" | "violin";

export interface PresentationOptions {
  showScreenShots: boolean;
  showGraphs: boolean;
  graphType: GraphTypes;
  hideMetric: string[];
  hideRisk: boolean;
}

export interface PresentationSlide {
  id: string;
  type: "experiment";
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
    headingFont: string;
    bodyFont: string;
  };
  sharable?: boolean;
  voting?: boolean;
  options?: PresentationOptions;
  slides: PresentationSlide[];
  dateCreated: Date;
  dateUpdated: Date;
}
