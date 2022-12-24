export interface SDKPayloadInterface {
  organization: string;
  project: string;
  environment: string;
  dateUpdated: Date;
  deployed: boolean;
  schemaVersion: 1;
  payload: string;
}
