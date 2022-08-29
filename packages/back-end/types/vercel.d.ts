export type GbVercelKeyMap = Array<{
  gb: string;
  vercel: string | null;
}>;

export type ApiKeyRow = {
  projectId: string;
  projectName: string;
  key: string;
  value: string;
  gbEnvironment: string;
  vercelEnvironment: string;
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
  target: string[];
};
