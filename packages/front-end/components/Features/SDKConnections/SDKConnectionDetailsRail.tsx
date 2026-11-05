import { ReactNode } from "react";
import { PiGlobe, PiWebhooksLogo, PiWarning } from "react-icons/pi";
import { date } from "shared/dates";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { Box, Flex, Separator } from "@radix-ui/themes";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import SDKLanguageLogo from "@/components/Features/SDKConnections/SDKLanguageLogo";
import { useDefinitions } from "@/services/DefinitionsContext";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Flex direction="column" gap="3" py="4">
      <Text
        size="sm"
        weight="medium"
        color="text-mid"
        textTransform="uppercase"
      >
        {title}
      </Text>
      {children}
    </Flex>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Flex direction="column" gap="1">
      <Text size="sm" color="text-mid">
        {label}
      </Text>
      <Box>{children}</Box>
    </Flex>
  );
}

// Read-only summary beside the Setup rows, like the experiment details rail.
export default function SDKConnectionDetailsRail({
  connection,
  webhookCount,
  onOpenWebhooks,
}: {
  connection: SDKConnectionInterface;
  webhookCount: number;
  onOpenWebhooks: () => void;
}) {
  const { getProjectById } = useDefinitions();
  const projects = connection.projects ?? [];

  return (
    <Box>
      <Group title="Status">
        {connection.connected ? (
          <Text>An SDK has fetched this payload.</Text>
        ) : (
          <Flex direction="column" gap="1">
            <Flex align="center" gap="2">
              <PiWarning style={{ color: "var(--amber-11)", flexShrink: 0 }} />
              <Text>No SDK has fetched this payload yet</Text>
            </Flex>
            <Text size="sm" color="text-mid">
              Install the SDK from the Implementation tab, then load your app.
            </Text>
          </Flex>
        )}
      </Group>
      <Separator size="4" />
      <Group title="General">
        <Item label="SDK">
          <Flex align="center" gap="3" wrap="wrap">
            {(connection.languages ?? []).map((language) => (
              <SDKLanguageLogo
                key={language}
                language={language}
                showLabel
                size={16}
                hideExtra
                version={
                  connection.languages.length === 1
                    ? connection.sdkVersion
                    : undefined
                }
              />
            ))}
          </Flex>
        </Item>
        <Item label="Environment">
          <Flex align="center" gap="2">
            <PiGlobe style={{ color: "var(--gray-11)" }} />
            <Text>{connection.environment}</Text>
          </Flex>
        </Item>
        <Item label="Projects">
          <Text>
            {projects.length
              ? projects.map((p) => getProjectById(p)?.name ?? p).join(", ")
              : "All Projects"}
          </Text>
        </Item>
        <Item label="Created">
          <Text>{date(connection.dateCreated)}</Text>
        </Item>
      </Group>
      <Separator size="4" />
      <Group title="Delivery">
        <Item label="Webhooks">
          <Flex align="center" gap="2">
            <PiWebhooksLogo style={{ color: "var(--gray-11)" }} />
            <Text>
              {webhookCount} webhook{webhookCount === 1 ? "" : "s"}
            </Text>
            <Link onClick={onOpenWebhooks}>Manage</Link>
          </Flex>
        </Item>
        <Item label="Proxy">
          <Text>{connection.proxy?.enabled ? "Enabled" : "Disabled"}</Text>
        </Item>
      </Group>
    </Box>
  );
}
