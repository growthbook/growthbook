export interface AdobeEpConnectionParams {
  host: string;
  port: number; // 80 if the org blocks 5432
  orgId: string; // "@AdobeOrg" appended on connect
  sandbox: string;
  container: string;
  flatten: boolean; // appends ?FLATTEN
  technicalAccountId: string;
  credential: string;
}
