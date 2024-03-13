import React from "react";
import { ApiKeyInterface } from "back-end/types/apikey";
import SDKConnectionsList from "@front-end/components/Features/SDKConnections/SDKConnectionsList";
import Tabs from "@front-end/components/Tabs/Tabs";
import Tab from "@front-end/components/Tabs/Tab";
import SDKEndpoints from "@front-end/components/Features/SDKEndpoints";
import Webhooks from "@front-end/components/Settings/Webhooks";
import useApi from "@front-end/hooks/useApi";

export default function SDKsPage() {
  const { data, mutate } = useApi<{ keys: ApiKeyInterface[] }>("/keys");

  return (
    <div className="container py-4">
      <Tabs defaultTab="connections" newStyle={true}>
        <Tab
          anchor="connections"
          id="connections"
          display="SDK Connections"
          padding={false}
        >
          <SDKConnectionsList />
        </Tab>
        <Tab
          anchor="legacy"
          id="legacy"
          display="Legacy Endpoints and Webhooks"
          padding={false}
          lazy
        >
          <div className="alert alert-info">
            <p>
              SDK Endpoints and Webhooks are deprecated. The new{" "}
              <strong>SDK Connections</strong> solve the same problems in an
              easier, more performant, and scalable way.
            </p>
            These legacy tools will continue to work just as before if you are
            unable to migrate at this time.
          </div>
          <SDKEndpoints keys={data?.keys || []} mutate={mutate} />
          <div className="mt-5">
            <h1>SDK Webhooks</h1>
            <Webhooks />
          </div>
        </Tab>
      </Tabs>
    </div>
  );
}
