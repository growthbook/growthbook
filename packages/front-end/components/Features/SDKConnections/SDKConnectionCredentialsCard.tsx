import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { Flex, Separator } from "@radix-ui/themes";
import { getApiBaseUrl } from "@/components/Features/CodeSnippetModal";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import Tooltip from "@/components/Tooltip/Tooltip";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import DataList, { DataListItem } from "@/ui/DataList";
import Frame from "@/ui/Frame";

export default function SDKConnectionCredentialsCard({
  connection,
}: {
  connection: SDKConnectionInterface;
}) {
  const hasProxy = !!connection.proxy?.enabled;
  const apiHost = getApiBaseUrl(connection);
  const clientKey = connection.key;
  const proxyHost = connection.proxy?.host || connection.proxy?.hostExternal;
  const proxyError = connection.proxy?.error;

  const details: DataListItem[] = [
    {
      label: "API Host",
      tooltip: hasProxy
        ? "Requests are routed through your GrowthBook Proxy."
        : undefined,
      value: <ClickToCopy compact>{apiHost}</ClickToCopy>,
    },
    {
      label: "Client Key",
      value: <ClickToCopy compact>{clientKey}</ClickToCopy>,
    },
  ];

  // Only meaningful once a proxy has been configured.
  if (proxyHost) {
    details.push({
      label: "Proxy Host",
      value: (
        <Flex align="center" gap="2" wrap="wrap">
          <ClickToCopy compact>{proxyHost}</ClickToCopy>
          {!connection.proxy?.enabled ? (
            <Tooltip body="Proxy was disabled for too many consecutive failures">
              <Badge color="red" variant="solid" label="Disabled" />
            </Tooltip>
          ) : null}
          {proxyError !== undefined && !connection.proxy?.connected ? (
            <Tooltip
              usePortal={true}
              body={
                <>
                  <div className="mb-2">
                    Encountered an error while trying to connect:
                  </div>
                  {proxyError ? (
                    <Callout status="error" mt="2">
                      {proxyError}
                    </Callout>
                  ) : (
                    <Callout status="error">
                      <em>Unknown error</em>
                    </Callout>
                  )}
                </>
              }
            >
              <Badge color="red" variant="soft" label="error" />
            </Tooltip>
          ) : null}
        </Flex>
      ),
    });
  }

  // Secret — only exists when the payload is encrypted, and stays hidden
  // until explicitly revealed.
  if (connection.encryptPayload && connection.encryptionKey) {
    details.push({
      label: "Decryption Key",
      value: (
        <ClickToReveal
          valueWhenHidden="decryption_key_hidden"
          getValue={async () => connection.encryptionKey}
        />
      ),
    });
  }

  return (
    <Frame mb="0">
      <DataList
        columns={1}
        data={[
          {
            label: "Full API Endpoint",
            value: (
              <ClickToCopy
                compact
              >{`${apiHost}/api/features/${clientKey}`}</ClickToCopy>
            ),
          },
        ]}
      />
      <Separator size="4" my="5" />
      <DataList columns={2} maxColumns={2} data={details} />
    </Frame>
  );
}
