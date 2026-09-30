import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { Flex, Separator } from "@radix-ui/themes";
import { getApiBaseUrl } from "@/components/Features/CodeSnippetModal";
import ProxyTestButton from "@/components/Features/SDKConnections/ProxyTestButton";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import Tooltip from "@/components/Tooltip/Tooltip";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import DataList, { DataListItem } from "@/ui/DataList";
import Frame from "@/ui/Frame";
import Text from "@/ui/Text";

export default function SDKConnectionCredentialsCard({
  connection,
  canUpdate = false,
  mutate,
}: {
  connection: SDKConnectionInterface;
  canUpdate?: boolean;
  mutate?: () => void;
}) {
  const proxy = connection.proxy;
  const hasProxy = !!proxy?.enabled;
  const apiHost = getApiBaseUrl(connection);
  const clientKey = connection.key;
  const proxyHost = proxy?.host || proxy?.hostExternal;
  const proxyError = proxy?.error;
  // Either currently enabled or was enabled but had too many failures.
  const showProxy =
    hasProxy || (!!proxy?.host && !!proxy?.consecutiveFailures && !!proxyError);

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

  if (showProxy) {
    details.push({
      label: "Proxy Host",
      value: (
        <Flex align="center" gap="2" wrap="wrap">
          <ClickToCopy compact>
            {proxyHost || "https://proxy.yoursite.io"}
          </ClickToCopy>
          {!hasProxy ? (
            <Tooltip body="Proxy was disabled for too many consecutive failures">
              <Badge color="red" variant="solid" label="Disabled" />
            </Tooltip>
          ) : null}
          {proxy?.connected ? (
            <Badge color="green" variant="solid" label="Connected" />
          ) : proxyError !== undefined ? (
            <Tooltip
              usePortal={true}
              body={
                <>
                  <Text as="p" mb="2">
                    Encountered an error while trying to connect:
                  </Text>
                  <Callout status="error">
                    {proxyError || <em>Unknown error</em>}
                  </Callout>
                </>
              }
            >
              <Badge color="red" variant="soft" label="Error" />
            </Tooltip>
          ) : (
            <Badge color="gray" variant="soft" label="Not connected" />
          )}
          {canUpdate && mutate && proxy?.host ? (
            <ProxyTestButton
              host={proxy.host}
              id={connection.id}
              mutate={mutate}
              showButton={true}
            />
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
