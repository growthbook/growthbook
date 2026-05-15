export interface BigQueryConnectionParams {
  authType?: "auto" | "json";
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
  reservation?: string;
  defaultProject: string;
  defaultDataset: string;
}
