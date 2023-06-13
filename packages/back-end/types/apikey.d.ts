export interface ApiKeyInterface {
  id?: string;
  key: string;
  environment?: string;
  project?: string;
  description?: string;
  organization: string;
  dateCreated: Date;
  encryptSDK?: boolean;
  encryptionKey: string;
  secret?: boolean;
}

export type PublishableApiKey = Omit<ApiKeyInterface, "secret"> & {
  secret: false;
};

export type SecretApiKey = Omit<
  ApiKeyInterface,
  "secret" | "environment" | "project" | "id"
> & {
  secret: true;
  id: string;
  encryptionKey?: string;
};

export type SecretApiKeyRedacted = Omit<SecretApiKey, "key">;
