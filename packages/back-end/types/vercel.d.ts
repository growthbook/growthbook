export type GbVercelEnvMap = Array<{
  vercel: VercelTarget;
  gb: string | null;
}>;

export type ApiKeyRow = {
  projectId: string;
  projectName: string;
  key: string;
  value: string;
  gbEnvironment: string;
  vercelEnvironment: VercelTarget[];
  description: string;
};

export type VercelProject = {
  name: string;
  id: string;
  configurationId?: string | null;
  accountId?: string;
};

export type VercelEnvVar = {
  key: string;
  value: string;
  target: VercelTarget[];
};

export type VercelTarget = "production" | "preview" | "development";

export enum VercelType {
  plain = "plain",
  secret = "secret",
  system = "system",
  encrypted = "encrypted",
}
