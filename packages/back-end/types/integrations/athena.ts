export interface AthenaConnectionParams {
  accessKeyId?: string;
  secretAccessKey?: string;
  region: string;
  database: string;
  bucketUri: string;
  workGroup?: string;
}
