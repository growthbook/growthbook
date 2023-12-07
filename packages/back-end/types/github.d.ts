export interface GitHubUserTokenInterface {
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
  GitHubUserTokenInterface,
  "id" | "organization" | "createdAt" | "updatedAt"
>;
