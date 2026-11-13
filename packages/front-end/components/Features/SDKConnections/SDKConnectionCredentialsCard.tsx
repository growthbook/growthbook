import { ReactNode } from "react";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { PiArrowSquareOut } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import { getApiBaseUrl } from "@/components/Features/CodeSnippetModal";
import ProxyTestButton from "@/components/Features/SDKConnections/ProxyTestButton";
import { languageMapping } from "@/components/Features/SDKConnections/SDKLanguageLogo";
import CopyableCode from "@/components/Settings/CopyableCode";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import Tooltip from "@/ui/Tooltip";
import LinkButton from "@/ui/LinkButton";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

const PROXIED = "Requests are routed through your GrowthBook Proxy.";

// What an SDK's configuration names it, as the implementation instructions do.
export function configSettingsTitle(connection: SDKConnectionInterface) {
  const language = connection.languages?.[0];
  const mapping = language ? languageMapping[language] : undefined;
  return `${mapping ? mapping.docLabel || mapping.label : "SDK"} Config Settings`;
}

// The values an SDK is configured with, as the implementation instructions
// list them.
// A value and what goes with it. In a flex row, not a line of text, so it
// shares the label's baseline exactly.
function Value({ children }: { children: ReactNode }) {
  return (
    <Flex align="center" gap="3" wrap="wrap">
      {children}
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
  const endpoint = `${apiHost}/api/features/${clientKey}`;
  const encryptionKey = connection.encryptPayload
    ? connection.encryptionKey
    : undefined;
  const proxyError = proxy?.error;
  // Either currently enabled or was enabled but had too many failures.
  const showProxy =
    hasProxy || (!!proxy?.host && !!proxy?.consecutiveFailures && !!proxyError);

  return (
    <>
      <SetupFieldRow
        label="Full API Endpoint"
        content="text"
        tooltip={hasProxy ? PROXIED : undefined}
      >
        <Value>
          <CopyableCode value={endpoint} />
          <LinkButton
            href={endpoint}
            external
            variant="outline"
            size="sm"
            icon={<PiArrowSquareOut />}
            iconPosition="right"
          >
            Open
          </LinkButton>
        </Value>
      </SetupFieldRow>
      <SetupFieldRow
        label="API Host"
        content="text"
        tooltip={hasProxy ? PROXIED : undefined}
      >
        <Value>
          <CopyableCode value={apiHost} />
        </Value>
      </SetupFieldRow>
      <SetupFieldRow label="Client Key" content="text">
        <Value>
          <CopyableCode value={clientKey} />
        </Value>
      </SetupFieldRow>
      {encryptionKey ? (
        <SetupFieldRow label="Decryption Key" content="text">
          <Value>
            <CopyableCode value={encryptionKey} />
          </Value>
        </SetupFieldRow>
      ) : null}
      {showProxy ? (
        <SetupFieldRow label="Proxy Host" content="text">
          <Value>
            <CopyableCode
              value={
                proxy?.host ||
                proxy?.hostExternal ||
                "https://proxy.yoursite.io"
              }
            />
            {!hasProxy ? (
              <Tooltip content="Proxy was disabled for too many consecutive failures">
                <Badge
                  color="red"
                  variant="soft"
                  radius="full"
                  label="Disabled"
                />
              </Tooltip>
            ) : null}
            {proxy?.connected ? (
              <Badge
                color="green"
                variant="soft"
                radius="full"
                label="Connected"
              />
            ) : proxyError !== undefined ? (
              <Tooltip
                content={
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
                <Badge color="red" variant="soft" radius="full" label="Error" />
              </Tooltip>
            ) : (
              <Badge
                color="gray"
                variant="soft"
                radius="full"
                label="Not connected"
              />
            )}
            {canUpdate && mutate && proxy?.host ? (
              <ProxyTestButton
                host={proxy.host}
                id={connection.id}
                mutate={mutate}
                showButton={true}
              />
            ) : null}
          </Value>
        </SetupFieldRow>
      ) : null}
    </>
  );
}
