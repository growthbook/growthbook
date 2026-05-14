export interface AthenaConnectionParams {
  authType?: "auto" | "accessKey" | "assumeRole";
  accessKeyId?: string;
  secretAccessKey?: string;
  assumeRoleARN?: string;
  roleSessionName?: string;
  durationSeconds?: number;
  externalId?: string;
  region: string;
  database?: string;
  bucketUri: string;
  workGroup?: string;
  catalog?: string;
  resultReuseMaxAgeInMinutes?: string;
}
