export interface ApiKeyInterface {
  key: string;
  environment?: string;
  description?: string;
  organization: string;
  includeDrafts?: boolean;
  dateCreated: Date;
}
