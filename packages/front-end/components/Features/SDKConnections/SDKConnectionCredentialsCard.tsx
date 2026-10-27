import { ReactNode } from "react";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { Box, Flex, Grid, Separator } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import { getApiBaseUrl } from "@/components/Features/CodeSnippetModal";
import ProxyTestButton from "@/components/Features/SDKConnections/ProxyTestButton";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import Tooltip from "@/components/Tooltip/Tooltip";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Text from "@/ui/Text";

const COLUMNS = { initial: "1", sm: "minmax(0, 2fr) minmax(0, 1fr)" };

function Field({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: string;
  children: ReactNode;
}) {
  return (
    <Flex direction="column" minWidth="0">
      <Text color="text-high" weight="semibold" mb="2">
        {label}
        {tooltip ? (
          <Tooltip body={tooltip}>
            <Text ml="1" size="lg">
              <PiInfo style={{ color: "var(--violet-11)" }} />
            </Text>
          </Tooltip>
        ) : null}
      </Text>
      <Box minWidth="0">{children}</Box>
    </Flex>
  );
}

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
  const showDecryptionKey = !!(
    connection.encryptPayload && connection.encryptionKey
  );

  return (
    <Frame mb="0">
      <Grid columns={COLUMNS} gapX="6" gapY="5">
        <Field
          label="Full API Endpoint"
          tooltip={
            hasProxy
              ? "Requests are routed through your GrowthBook Proxy."
              : undefined
          }
        >
          <ClickToCopy
            compact
            iconPosition="right"
          >{`${apiHost}/api/features/${clientKey}`}</ClickToCopy>
        </Field>
        <Field label="Client Key">
          <ClickToCopy compact iconPosition="right">
            {clientKey}
          </ClickToCopy>
        </Field>
      </Grid>
      {showDecryptionKey || showProxy ? (
        <>
          <Separator size="4" my="5" />
          <Grid columns={COLUMNS} gapX="6" gapY="5">
            {showDecryptionKey ? (
              <Field label="Decryption Key">
                <ClickToReveal
                  valueWhenHidden="decryption_key_hidden"
                  getValue={async () => connection.encryptionKey}
                />
              </Field>
            ) : null}
            {showProxy ? (
              <Field label="Proxy Host">
                <Flex align="center" gap="2" wrap="wrap">
                  <ClickToCopy compact iconPosition="right">
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
              </Field>
            ) : null}
          </Grid>
        </>
      ) : null}
    </Frame>
  );
}
