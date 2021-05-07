import mongoose from "mongoose";

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
  datasource: string;
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

export type ReportDocument = mongoose.Document & ReportInterface;

const reportSchema = new mongoose.Schema({
  id: String,
  organization: String,
  title: String,
  description: String,
  queries: [
    {
      _id: false,
      datasource: String,
      query: String,
      showTable: Boolean,
      visualizations: [
        {
          _id: false,
          title: String,
          type: { type: String },
          xAxis: [String],
          yAxis: [String],
          color: String,
          options: {},
        },
      ],
    },
  ],
  dateCreated: Date,
  dateUpdated: Date,
});

export const ReportModel = mongoose.model<ReportDocument>(
  "Report",
  reportSchema
);
