import { ReactNode } from "react";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { PiArrowSquareOut } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import { getApiBaseUrl } from "@/components/Features/CodeSnippetModal";
import ProxyTestButton from "@/components/Features/SDKConnections/ProxyTestButton";
import WebhookErrorDetails from "@/components/Features/SDKConnections/WebhookErrorDetails";
import { languageMapping } from "@/components/Features/SDKConnections/SDKLanguageLogo";
import CopyableCode from "@/components/Settings/CopyableCode";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import { isCloud } from "@/services/env";
import Tooltip from "@/ui/Tooltip";
import { Popover } from "@/ui/Popover";
import LinkButton from "@/ui/LinkButton";
import Badge from "@/ui/Badge";

const PROXIED = "Requests are routed through your GrowthBook Proxy.";
const PROXY_FROM_ENV =
  "Set for the whole instance by the PROXY_ENABLED and PROXY_HOST_PUBLIC environment variables, not on this SDK Connection.";

// What an SDK's configuration names it, as the implementation instructions do.
export function configSettingsTitle(connection: SDKConnectionInterface) {
  const language = connection.languages[0];
  const mapping = language ? languageMapping[language] : undefined;
  return `${mapping ? mapping.docLabel || mapping.label : "SDK"} Config Settings`;
}

// A value and what goes with it. In a flex row, not a line of text, so it
// shares the label's baseline exactly.
function Value({ children }: { children: ReactNode }) {
  return (
    <Flex align="center" gap="3" wrap="wrap">
      {children}
    </Flex>
  );
}

// The values an SDK is configured with, as the implementation instructions
// list them.
export default function SDKConnectionCredentialsCard({
  connection,
  canUpdate,
  mutate,
}: {
  connection: SDKConnectionInterface;
  canUpdate: boolean;
  mutate: () => void;
}) {
  const proxy = connection.proxy;
  const hasProxy = proxy.enabled;
  const apiHost = getApiBaseUrl(connection);
  const clientKey = connection.key;
  const endpoint = `${apiHost}/api/features/${clientKey}`;
  const encryptionKey = connection.encryptPayload
    ? connection.encryptionKey
    : undefined;
  const proxyError = proxy.error;
  // Either currently enabled or was enabled but had too many failures.
  const showProxy =
    hasProxy || (!!proxy.host && !!proxy.consecutiveFailures && !!proxyError);

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
        <SetupFieldRow
          label="Proxy Host"
          content="text"
          labelBadge={
            isCloud() ? null : (
              <Tooltip content={PROXY_FROM_ENV}>
                {/* Focusable, so the tip opens from the keyboard too. */}
                <span tabIndex={0}>
                  <Badge label="Env vars" color="gray" variant="soft" ml="1" />
                </span>
              </Tooltip>
            )
          }
        >
          <Value>
            <CopyableCode
              value={
                proxy.host || proxy.hostExternal || "https://proxy.yoursite.io"
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
            {proxy.connected ? (
              <Badge
                color="green"
                variant="soft"
                radius="full"
                label="Connected"
              />
            ) : proxyError ? (
              <Popover
                openOnHover
                side="bottom"
                contentStyle={{ maxWidth: 420 }}
                trigger={
                  <Badge
                    color="red"
                    variant="soft"
                    radius="full"
                    label="Error"
                    style={{ cursor: "default" }}
                  />
                }
                content={
                  <WebhookErrorDetails
                    name="Could not connect to the proxy"
                    error={proxyError}
                  />
                }
              />
            ) : (
              <Badge
                color="gray"
                variant="soft"
                radius="full"
                label="Not connected"
              />
            )}
            {canUpdate && proxy.host ? (
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
