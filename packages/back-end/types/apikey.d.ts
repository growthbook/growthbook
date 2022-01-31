export interface ApiKeyInterface {
  key: string;
  environment?: string;
  description?: string;
  organization: string;
  dateCreated: Date;
}
