import { Box, Code as InlineCode, Flex } from "@radix-ui/themes";
import { getApiHost, isCloud, usingSSO } from "@/services/env";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useUser } from "@/services/UserContext";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import DataList, { DataListItem } from "@/ui/DataList";

export default function ScimCard() {
  const { copySupported, copySuccess, performCopy } = useCopyToClipboard({
    timeout: 1200,
  });

  const { hasCommercialFeature, users } = useUser();
  const hasScimFeature = hasCommercialFeature("scim");

  // The back-end SCIM middleware requires SSO/OpenID auth to be active, which
  // is always the case on Cloud and requires SSO_CONFIG when self-hosting
  const ssoReady = isCloud() || usingSSO();
  const scimAvailable = hasScimFeature && ssoReady;

  const scimBaseUrl = `${getApiHost()}/scim/v2`;
  const managedCount = Array.from(users.values()).filter(
    (m) => m.managedByIdp,
  ).length;

  const details: DataListItem[] = [
    {
      label: "Base URL",
      tooltip:
        "Enter this as the SCIM connector base URL in your identity provider.",
      value: (
        <>
          <InlineCode>{scimBaseUrl}</InlineCode>
          {copySupported ? (
            <Button
              ml="2"
              variant="ghost"
              size="xs"
              onClick={() => performCopy(scimBaseUrl)}
            >
              {copySuccess ? "Copied" : "Copy"}
            </Button>
          ) : null}
        </>
      ),
    },
    {
      label: "Bearer token",
      tooltip: "We recommend creating a dedicated key for SCIM.",
      value: (
        <>
          Use a secret API key with the Admin role.{" "}
          <Link href="/settings/keys">Manage API keys</Link>
        </>
      ),
    },
    {
      label: "Managed members",
      value:
        managedCount > 0 ? (
          `${managedCount} member${
            managedCount === 1 ? " is" : "s are"
          } managed by your identity provider`
        ) : (
          <Text color="text-low">
            None yet &mdash; assign users to GrowthBook in your identity
            provider to provision them
          </Text>
        ),
    },
  ];

  return (
    <Frame>
      <Flex align="center" gap="4">
        <Box flexGrow="1" minWidth="0">
          <Flex align="center" gap="2">
            <Text size="x-large" weight="semibold">
              Automated user provisioning (SCIM)
            </Text>
            {scimAvailable ? (
              <Badge label="Available" color="green" variant="soft" />
            ) : !hasScimFeature ? (
              <Badge label="Enterprise" color="amber" variant="soft" />
            ) : (
              <Badge label="Requires SSO" color="gray" variant="soft" />
            )}
          </Flex>
          <Text as="div" size="small" color="text-mid">
            Provision and deprovision members and Teams from your identity
            provider. Okta and Azure AD / Microsoft Entra ID are supported.
          </Text>
        </Box>
        <Flex align="center" gap="2" flexShrink="0">
          <LinkButton
            variant="ghost"
            href="https://docs.growthbook.io/integrations/scim"
            external={true}
          >
            View docs
          </LinkButton>
        </Flex>
      </Flex>
      {!hasScimFeature ? (
        <Text as="div" size="small" color="text-mid" mt="4">
          SCIM user provisioning is available on the GrowthBook Enterprise plan.
        </Text>
      ) : !ssoReady ? (
        <Text as="div" size="small" color="text-mid" mt="4">
          Enable SSO for your GrowthBook instance to use SCIM.
        </Text>
      ) : (
        <DataList data={details} columns={1} mt="4" />
      )}
    </Frame>
  );
}
