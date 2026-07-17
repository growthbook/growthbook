import React, { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { ApiKeyInterface } from "shared/types/apikey";
import { WebhookInterface } from "shared/types/webhook";
import SDKConnectionsList from "@/components/Features/SDKConnections/SDKConnectionsList";
import SDKEndpoints, {
  getPublishableKeys,
} from "@/components/Features/SDKEndpoints";
import Webhooks from "@/components/Settings/Webhooks";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { GBArrowLeft } from "@/components/Icons";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";

export default function SDKsPage() {
  const { data, mutate } = useApi<{ keys: ApiKeyInterface[] }>("/keys");
  const { project } = useDefinitions();

  // Only show the legacy SDK Endpoints and Webhooks if there are any
  const [legacy, setLegacy] = useState(false);
  const hasLegacyEndpoints =
    getPublishableKeys(data?.keys || [], project).length > 0;

  const { data: legacyWebhookData } = useApi<{ webhooks: WebhookInterface[] }>(
    "/legacy-sdk-webhooks",
  );
  const hasLegacyWebhooks = !!legacyWebhookData?.webhooks?.length;
  const legacyEnabled = hasLegacyEndpoints || hasLegacyWebhooks;

  return (
    <div className="container py-4">
      {legacyEnabled && (
        <div className="mb-3">
          <Link
            onClick={() => {
              setLegacy(!legacy);
            }}
          >
            {legacy ? (
              <>
                <GBArrowLeft /> Back to SDK Connections
              </>
            ) : (
              "View Legacy SDK Endpoints and Webhooks"
            )}
          </Link>
        </div>
      )}

      {legacyEnabled && legacy ? (
        <>
          <Callout status="warning">
            <Heading as="h3" mb="3">
              Deprecated
            </Heading>
            <Flex direction="column" gap="1">
              <Text mb="2">
                Legacy SDK Endpoints and Webhooks are deprecated. We recommend
                migrating to <strong>SDK Connections</strong>, which solve the
                same problems in an easier, more performant, and scalable way.
              </Text>
              <Text>
                Existing Legacy SDK Endpoints and Webhooks will continue to
                work, but are in a read-only state. After migrating, you can
                delete them here.
              </Text>
            </Flex>
          </Callout>
          {hasLegacyEndpoints && (
            <SDKEndpoints keys={data?.keys || []} mutate={mutate} />
          )}
          {hasLegacyWebhooks && (
            <div className="mt-5">
              <h1>Legacy SDK Webhooks</h1>
              <Webhooks />
            </div>
          )}
        </>
      ) : (
        <SDKConnectionsList />
      )}
    </div>
  );
}
