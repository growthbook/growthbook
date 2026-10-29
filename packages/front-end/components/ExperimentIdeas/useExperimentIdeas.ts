import { useCallback, useMemo } from "react";
import { ExperimentIdeaListItem } from "shared/validators";
import { getExperimentIdeaStages } from "shared/experiment-ideas";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";

export function useExperimentIdeaStages() {
  const settings = useOrgSettings();
  return useMemo(() => getExperimentIdeaStages(settings), [settings]);
}

export function useExperimentIdeas(includeArchived: boolean) {
  const { data, error, mutate } = useApi<{ ideas: ExperimentIdeaListItem[] }>(
    `/experiment-ideas${includeArchived ? "?includeArchived=true" : ""}`,
  );
  const { apiCall } = useAuth();

  // Optimistic: patch the cached list, then revalidate (reverting on failure).
  const patchIdea = useCallback(
    async (
      id: string,
      patch: Partial<ExperimentIdeaListItem>,
      request: () => Promise<unknown>,
    ) => {
      await mutate(
        (current) =>
          current && {
            ...current,
            ideas: current.ideas.map((i) =>
              i.id === id ? { ...i, ...patch } : i,
            ),
          },
        false,
      );
      try {
        await request();
      } finally {
        await mutate();
      }
    },
    [mutate],
  );

  const setStage = useCallback(
    (idea: ExperimentIdeaListItem, stage: string) =>
      patchIdea(idea.id, { stage }, () =>
        apiCall(`/experiment-ideas/${idea.id}`, {
          method: "PUT",
          body: JSON.stringify({ stage }),
        }),
      ),
    [apiCall, patchIdea],
  );

  const toggleUpvote = useCallback(
    (idea: ExperimentIdeaListItem) => {
      const upvoted = !idea.upvotedByMe;
      return patchIdea(
        idea.id,
        {
          upvotedByMe: upvoted,
          upvoteCount: idea.upvoteCount + (upvoted ? 1 : -1),
        },
        () =>
          apiCall(`/experiment-ideas/${idea.id}/upvote`, {
            method: upvoted ? "POST" : "DELETE",
          }),
      );
    },
    [apiCall, patchIdea],
  );

  return {
    ideas: data?.ideas,
    error,
    mutate,
    setStage,
    toggleUpvote,
  };
}
