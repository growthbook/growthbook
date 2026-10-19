import React, { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
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
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";

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
    <Box className="contents pagecontents" style={{ margin: "0 auto" }}>
      {legacyEnabled && legacy ? (
        <>
          <Box mt="4" mb="3">
            <Link onClick={() => setLegacy(false)}>
              <Flex align="center" gap="1">
                <GBArrowLeft /> Back to SDK Connections
              </Flex>
            </Link>
          </Box>
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
            <Box mt="5">
              <Heading as="h2" size="xl" mb="3">
                Legacy SDK Webhooks
              </Heading>
              <Webhooks />
            </Box>
          )}
        </>
      ) : (
        <>
          <SDKConnectionsList />
          {legacyEnabled && (
            <Box mt="5">
              <Link onClick={() => setLegacy(true)}>
                View Legacy SDK Endpoints and Webhooks
              </Link>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
