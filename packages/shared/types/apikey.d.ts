export interface ApiKeyInterface {
  id?: string;
  key: string;
  environment?: string;
  project?: string;
  description?: string;
  organization: string;
  dateCreated: Date;
  userId?: string;
  role?: string;
  encryptSDK?: boolean;
  encryptionKey?: string;
  secret?: boolean;
}

export type SecretApiKey = Omit<
  ApiKeyInterface,
  "secret" | "environment" | "project" | "id"
> & {
  secret: true;
  id: string;
  encryptionKey?: string;
};

export type SecretApiKeyRedacted = Omit<SecretApiKey, "key">;
