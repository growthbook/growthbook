export interface GithubUserTokenInterface {
  id: string;
  token: string;
  expiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateGithubUserTokenInput = Omit<
  GithubUserTokenInterface,
  "id" | "createdAt" | "updatedAt"
>;

export interface GithubIntegrationInterface {
  id: string;
  organization: string;
  tokenId: string;
  createdBy: string;
  createdAt: Date;
}

export type CreateGithubIntegrationInput = Omit<
  GithubIntegrationInterface,
  "id" | "createdAt"
>;
