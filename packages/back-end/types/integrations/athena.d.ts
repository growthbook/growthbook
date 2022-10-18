export interface AthenaConnectionParams {
  authType?: "auto" | "accessKey";
  accessKeyId?: string;
  secretAccessKey?: string;
  region: string;
  database: string;
  bucketUri: string;
  workGroup?: string;
}
