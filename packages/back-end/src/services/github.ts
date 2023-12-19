import { Octokit } from "@octokit/rest";
import { GithubUserTokenInterface } from "../../types/github";
import { getGithubUserToken } from "../models/GithubUserTokenModel";

export const fetchRepositories = async (
  tokenId: GithubUserTokenInterface["id"]
) => {
  const octokit = new Octokit({
    auth: await getGithubUserToken(tokenId),
  });
  const { data } = await octokit.repos.listForAuthenticatedUser();
  return data;
};
