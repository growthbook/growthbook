import React, { useState } from "react";
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
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
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
          </a>
        </div>
      )}

      {legacyEnabled && legacy ? (
        <>
          <div className="alert alert-warning">
            <h3>Deprecated</h3>
            <p>
              Legacy SDK Endpoints and Webhooks are deprecated. We recommend
              migrating to <strong>SDK Connections</strong>, which solve the
              same problems in an easier, more performant, and scalable way.
            </p>
            Existing Legacy SDK Endpoints and Webhooks will continue to work,
            but are in a read-only state. After migrating, you can delete them
            here.
          </div>
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
