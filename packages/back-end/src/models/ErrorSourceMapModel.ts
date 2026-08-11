import mongoose from "mongoose";

const errorSourceMapSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  organization: { type: String, index: true },
  clientKey: { type: String, index: true },
  /** Release / version label (e.g. git SHA). */
  release: { type: String, index: true },
  /** Original minified URL as reported by the browser stack frame. */
  minifiedUrl: { type: String },
  /** Raw source map JSON (may be large). */
  sourceMapJson: { type: String },
  dateCreated: Date,
  dateUpdated: Date,
});

errorSourceMapSchema.index(
  { organization: 1, clientKey: 1, release: 1, minifiedUrl: 1 },
  { unique: true },
);

export type ErrorSourceMapDocument = mongoose.Document & {
  id: string;
  organization: string;
  clientKey: string;
  release: string;
  minifiedUrl: string;
  sourceMapJson: string;
  dateCreated: Date;
  dateUpdated: Date;
};

export const ErrorSourceMapModel = mongoose.model<ErrorSourceMapDocument>(
  "ErrorSourceMap",
  errorSourceMapSchema,
);
