import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { WebhookInterface } from "back-end/types/webhook";
import useApi from "./useApi";

interface UseSDKConnectionsOptions {
  includeWebhooks?: boolean;
}

export default function useSDKConnections(
  options: UseSDKConnectionsOptions = {}
) {
  const { includeWebhooks = false } = options;

  const connectionsResponse = useApi<{
    connections: SDKConnectionInterface[];
  }>(`/sdk-connections`);

  const webhooksResponse = useApi<{
    webhooks: Record<string, WebhookInterface[]>;
  }>(`/sdk-connections/webhooks`, { shouldRun: () => includeWebhooks });

  return {
    data: {
      connections: connectionsResponse.data?.connections ?? [],
      webhooks: webhooksResponse.data?.webhooks ?? {},
    },
    error: connectionsResponse.error || webhooksResponse.error,
    mutate: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promises: Promise<any>[] = [connectionsResponse.mutate?.()];
      if (includeWebhooks) {
        promises.push(webhooksResponse.mutate?.());
      }
      await Promise.all(promises);
    },
  };
}
