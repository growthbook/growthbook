import { Octokit } from "@octokit/rest";
import { EmitterWebhookEvent, Webhooks } from "@octokit/webhooks";
import { GithubUserTokenInterface } from "../../types/github";
import { getGithubUserToken } from "../models/GithubUserTokenModel";
import {
  deleteGithubIntegration,
  getGithubIntegrationByInstallationId,
} from "../models/GithubIntegration";

export const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET || "secret",
});

webhooks.on(
  "installation",
  async ({
    payload,
  }: {
    id: string;
    name: string;
    payload: EmitterWebhookEvent<"installation">["payload"];
  }) => {
    if (payload.action === "deleted") {
      const installationId = `${payload.installation.id}`;
      const githubIntegration = await getGithubIntegrationByInstallationId(
        installationId
      );
      if (!githubIntegration) {
        // eslint-disable-next-line no-console
        console.error(
          "Received installation.deleted event for unknown installationId",
          installationId
        );
        return;
      }
      await deleteGithubIntegration(githubIntegration);
    }
  }
);

webhooks.on("installation_repositories", async ({ id, name, payload }) => {
  // eslint-disable-next-line no-console
  console.log("installation_repositories event", id, name, payload);
});

webhooks.on(
  "push",
  async ({
    id,
    name,
    payload,
  }: {
    id: string;
    name: string;
    payload: EmitterWebhookEvent<"push">["payload"];
  }) => {
    const ref = payload.ref;
    // only interested in pushes to main branch
    if (ref !== "refs/heads/main") return;
    // eslint-disable-next-line no-console
    console.log("push event", id, name, payload);
  }
);

export const fetchRepositories = async (
  tokenId: GithubUserTokenInterface["id"]
) => {
  const octokit = new Octokit({
    auth: await getGithubUserToken(tokenId),
  });
  const { data } = await octokit.repos.listForAuthenticatedUser();
  return data;
};
