export interface QueryResult {
  timestamp: Date;
  rows: {
    [key: string]: string;
  }[];
}

export type VisualizationOptions = Record<string, unknown>;

export interface Visualization {
  title: string;
  type: string;
  xAxis?: string[];
  yAxis?: string[];
  color?: string;
  options?: VisualizationOptions;
}
export interface Query {
  source: string;
  query: string;
  showTable: boolean;
  visualizations: Visualization[];
}
export interface ReportInterface {
  id: string;
  organization: string;
  title: string;
  description: string;
  queries: Query[];
  dateCreated: Date;
  dateUpdated: Date;
}
