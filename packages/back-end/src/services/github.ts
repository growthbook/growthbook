import { Octokit } from "@octokit/rest";
import { GithubUserTokenInterface } from "shared/types/github";
import { getGithubUserToken } from "back-end/src/models/GithubUserTokenModel";

export const fetchRepositories = async (
  tokenId: GithubUserTokenInterface["id"],
) => {
  const octokit = new Octokit({
    auth: await getGithubUserToken(tokenId),
  });
  const { data } = await octokit.repos.listForAuthenticatedUser();
  return data;
};
