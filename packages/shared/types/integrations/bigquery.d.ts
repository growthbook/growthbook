export interface BigQueryConnectionParams {
  authType?: "auto" | "json";
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
  /** Full raw JSON from the uploaded GCP key file; used to build the Confluent connector keyfile when the draft has no embedded copy. */
  serviceAccountJson?: string;
  reservation?: string;
  defaultProject: string;
  defaultDataset: string;
}
