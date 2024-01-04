import { EmitterWebhookEvent, Webhooks } from "@octokit/webhooks";
import {
  addRepositoriesToIntegration,
  removeRepositoriesFromIntegration,
  deleteGithubIntegrationById,
  getGithubIntegrationByInstallationId,
} from "../models/GithubIntegration";

export const webhooks = process.env.GITHUB_WEBHOOK_SECRET
  ? new Webhooks({
      secret: process.env.GITHUB_WEBHOOK_SECRET,
    })
  : null;

webhooks?.on<"installation">(
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
      await deleteGithubIntegrationById(githubIntegration.id);
    }
  }
);

webhooks?.on<"installation_repositories">(
  "installation_repositories",
  async ({ payload }) => {
    const { action } = payload;
    const integration = await getGithubIntegrationByInstallationId(
      `${payload.installation.id}`
    );

    if (!integration) throw new Error("Github integration does not exist");

    if (action === "added") {
      const repos = payload.repositories_added;
      await addRepositoriesToIntegration(
        integration.id,
        repos.map((repo) => ({
          id: repo.id,
          name: repo.name,
          watching: false,
        }))
      );
    } else if (action === "removed") {
      const repos = payload.repositories_removed;
      await removeRepositoriesFromIntegration(
        integration.id,
        repos.map((r) => r.id)
      );
    }
  }
);

webhooks?.on<"push">("push", async ({ payload }) => {
  const ref = payload.ref;
  const defaultBranch = payload.repository.default_branch;
  const isDefaultBranch = ref === `refs/heads/${defaultBranch}`;

  // only interested in pushes to default branch
  if (!isDefaultBranch) return;

  const repoId = payload.repository.id;
  const integration = await getGithubIntegrationByInstallationId(
    `${payload.installation?.id}`
  );

  if (!integration) throw new Error("Github integration does not exist");

  const repo = integration.repositories.find((r) => r.id === repoId);

  if (!repo) throw new Error("Repo not found in integration");

  if (!repo.watching) return;

  await scanRepo(repoId);
});

const scanRepo = async (repoId: number) => {
  // eslint-disable-next-line no-console
  console.log("TODO scan repo", repoId);
};
