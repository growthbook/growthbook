import mongoose from "mongoose";
import { DataSourceInterface } from "../../types/datasource";

const dataSourceSchema = new mongoose.Schema({
  id: String,
  name: String,
  organization: String,
  dateCreated: Date,
  dateUpdated: Date,
  type: { type: String },
  params: String,
  settings: {
    default: {
      timestampColumn: String,
      userIdColumn: String,
      anonymousIdColumn: String,
    },
    experiments: {
      table: String,
      timestampColumn: String,
      userIdColumn: String,
      anonymousIdColumn: String,
      experimentIdColumn: String,
      variationColumn: String,
      variationFormat: String,
    },
    users: {
      table: String,
      userIdColumn: String,
    },
    identifies: {
      table: String,
      userIdColumn: String,
      anonymousIdColumn: String,
    },
    pageviews: {
      table: String,
      urlColumn: String,
      timestampColumn: String,
      userIdColumn: String,
      anonymousIdColumn: String,
    },
  },
});
export type DataSourceDocument = mongoose.Document & DataSourceInterface;

export const DataSourceModel = mongoose.model<DataSourceDocument>(
  "DataSource",
  dataSourceSchema
);
