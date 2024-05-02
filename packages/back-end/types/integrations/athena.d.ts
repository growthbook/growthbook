export interface AthenaConnectionParams {
  authType?: "auto" | "accessKey" | "assumeRole";
  accessKeyId?: string;
  secretAccessKey?: string;
  assumeRoleARN?: string;
  roleSessionName?: string;
  durationSeconds?: string;
  externalId?: string;
  region: string;
  database?: string;
  bucketUri: string;
  workGroup?: string;
  catalog?: string;
}
