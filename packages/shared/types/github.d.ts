export interface GithubUserTokenInterface {
  id: string;
  organization: string;
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

interface GithubIntegrationRepository {
  id: string;
  name: string;
  watching: boolean;
}

export interface GithubIntegrationInterface {
  id: string;
  organization: string;
  tokenId: string;
  createdBy: string;
  createdAt: Date;
  repositories: GithubIntegrationRepository[];
}

export type CreateGithubIntegrationInput = Omit<
  GithubIntegrationInterface,
  "id" | "createdAt" | "repositories"
>;
