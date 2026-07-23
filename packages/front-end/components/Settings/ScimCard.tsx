import { Box, Flex } from "@radix-ui/themes";
import { getApiHost, isCloud, usingSSO } from "@/services/env";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useUser } from "@/services/UserContext";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import LinkButton from "@/ui/LinkButton";
import styles from "./SSOSettings.module.scss";

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

  return (
    <div className="appbox" style={{ marginTop: 16 }}>
      <Flex align="center" gap="4" className={styles.cardPad}>
        <Box flexGrow="1" minWidth="0">
          <Flex align="center" gap="2">
            <span className={styles.cardTitle}>
              Automated user provisioning (SCIM)
            </span>
            {scimAvailable ? (
              <Badge
                label={
                  <>
                    <span className={styles.statusDot} />
                    Available
                  </>
                }
                color="green"
                variant="soft"
              />
            ) : !hasScimFeature ? (
              <Badge label="Enterprise" color="amber" variant="soft" />
            ) : (
              <Badge label="Requires SSO" color="gray" variant="soft" />
            )}
          </Flex>
          <div className={styles.cardSubtitle}>
            Provision and deprovision members and Teams from your identity
            provider. Okta and Azure AD / Microsoft Entra ID are supported.
          </div>
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
        <div className={styles.cardNote}>
          SCIM user provisioning is available on the GrowthBook Enterprise plan.
        </div>
      ) : !ssoReady ? (
        <div className={styles.cardNote}>
          Enable SSO for your GrowthBook instance to use SCIM.
        </div>
      ) : (
        <div className={styles.detailsGrid}>
          <div className={styles.detailLabel}>Base URL</div>
          <div className={styles.detailValue}>
            <Flex align="center" gap="2">
              <span className={styles.mono}>{scimBaseUrl}</span>
              {copySupported ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => performCopy(scimBaseUrl)}
                >
                  {copySuccess ? "Copied" : "Copy"}
                </Button>
              ) : null}
            </Flex>
            <div className={styles.smallNote}>
              Enter this as the SCIM connector base URL in your identity
              provider.
            </div>
          </div>

          <div className={styles.detailLabel}>Bearer token</div>
          <div className={styles.detailValue}>
            Use a secret API key with the Admin role.{" "}
            <Link href="/settings/keys">Manage API keys</Link>
            <div className={styles.smallNote}>
              We recommend creating a dedicated key for SCIM.
            </div>
          </div>

          <div className={styles.detailLabel}>Managed members</div>
          <div className={styles.detailValue}>
            {managedCount > 0 ? (
              <>
                {managedCount} member{managedCount === 1 ? " is" : "s are"}{" "}
                managed by your identity provider
              </>
            ) : (
              <span className={styles.subtle}>
                None yet &mdash; assign users to GrowthBook in your identity
                provider to provision them
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
