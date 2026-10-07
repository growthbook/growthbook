import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/services/auth";

export type SlackChannelOption = {
  id: string;
  name: string;
  isPrivate: boolean;
  alreadyConnected: boolean;
};

const byName = (a: SlackChannelOption, b: SlackChannelOption) =>
  a.name.localeCompare(b.name);

export default function useSlackChannels(teamId: string) {
  const { apiCall } = useAuth();
  const [channels, setChannels] = useState<SlackChannelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const fresh = new Map<string, SlackChannelOption>();
        let cursor: string | null = null;
        do {
          const response = await apiCall<{
            channels: SlackChannelOption[];
            nextCursor: string | null;
          }>(
            `/integrations/slack/channels?teamId=${encodeURIComponent(teamId)}${
              cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
            }`,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          response.channels.forEach((channel) =>
            fresh.set(channel.id, channel),
          );
          // On refresh, keep earlier results until the walk completes so the
          // list (and the selection) doesn't shrink to the first page.
          setChannels((prev) =>
            [
              ...prev.filter((channel) => !fresh.has(channel.id)),
              ...fresh.values(),
            ].sort(byName),
          );
          cursor = response.nextCursor;
        } while (cursor);
        setChannels([...fresh.values()].sort(byName));
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(
          e instanceof Error ? e.message : "Failed to load Slack channels.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, [apiCall, teamId, refreshCount]);

  const refresh = useCallback(() => setRefreshCount((count) => count + 1), []);

  return { channels, loading, error, refresh };
}
