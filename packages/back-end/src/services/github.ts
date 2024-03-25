import { Octokit } from "@octokit/rest";
import { getGithubUserToken } from "@back-end/src/models/GithubUserTokenModel";
import { GithubUserTokenInterface } from "@back-end/types/github";

export const fetchRepositories = async (
  tokenId: GithubUserTokenInterface["id"]
) => {
  const octokit = new Octokit({
    auth: await getGithubUserToken(tokenId),
  });
  const { data } = await octokit.repos.listForAuthenticatedUser();
  return data;
};
