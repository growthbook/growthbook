import { SSOConnectionInterface } from "shared/types/sso-connection";
import { useState } from "react";
import clsx from "clsx";
import { Box, Flex } from "@radix-ui/themes";
import { datetime } from "shared/dates";
import { getSSOProviderDocsUrl, SSO_IDP_TYPE_OPTIONS } from "shared/util";
import { isCloud, usingSSO } from "@/services/env";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import Code from "@/components/SyntaxHighlighting/Code";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Switch from "@/ui/Switch";
import LoadingSpinner from "@/components/LoadingSpinner";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import EditSSOConnectionModal from "@/components/Settings/EditSSOConnectionModal";
import ScimCard from "@/components/Settings/ScimCard";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import styles from "./SSOSettings.module.scss";

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className={styles.detailLabel}>{label}</div>
      <div className={styles.detailValue}>{children}</div>
    </>
  );
}

export default function SSOSettings() {
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [enforceError, setEnforceError] = useState("");
  // Kept in memory only; never saved
  const [generatedConfig, setGeneratedConfig] = useState<{
    value: string;
    idpType?: SSOConnectionInterface["idpType"];
  } | null>(null);

  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const hasSSOFeature = hasCommercialFeature("sso");

  const { data, mutate, error } = useApi<{
    ssoConnection: Partial<SSOConnectionInterface> | null;
    managedByEnv: boolean;
    enforceSSO: boolean;
    loggedInViaConnection: boolean;
  }>("/sso-connection");

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (!data) {
    return <LoadingSpinner />;
  }

  const connection = data.ssoConnection;

  if (!connection) {
    if (!hasSSOFeature) {
      return (
        <PremiumEmptyState
          title="Enterprise SSO"
          description="Let members of your organization sign in through your identity provider. Single sign-on is available on the GrowthBook Enterprise plan."
          commercialFeature="sso"
          learnMoreLink="https://docs.growthbook.io/sso"
        />
      );
    }
    // Self-hosted without SSO_CONFIG can't use DB connections, so offer to
    // generate the environment variable instead
    const envSetupMode = !isCloud() && !usingSSO();
    const generatedConfigIdpLabel = SSO_IDP_TYPE_OPTIONS.find(
      (o) => o.value === generatedConfig?.idpType,
    )?.label;
    return (
      <>
        {editOpen ? (
          <EditSSOConnectionModal
            close={() => setEditOpen(false)}
            current={null}
            mode={envSetupMode ? "generate" : "save"}
            onGenerate={(envValue, idpType) => {
              setGeneratedConfig({ value: envValue, idpType });
              setEditOpen(false);
            }}
            onSave={() => {
              setEditOpen(false);
              mutate();
            }}
          />
        ) : null}
        <div className={clsx("appbox", styles.emptyState)}>
          <Flex direction="column" align="center">
            <div className={styles.emptyTitle}>Set up single sign-on</div>
            <p className={styles.emptyBody}>
              {envSetupMode
                ? "Connect an OpenID Connect identity provider like Auth0, Okta, or Microsoft Entra ID. Self-hosted instances enable SSO with the SSO_CONFIG environment variable, which you can generate here."
                : "Connect an OpenID Connect identity provider like Auth0, Okta, or Microsoft Entra ID. Members will sign in to GrowthBook through your provider."}
            </p>
            <Flex align="center" gap="2">
              <Button onClick={() => setEditOpen(true)}>
                {envSetupMode ? "Generate config" : "Set up SSO"}
              </Button>
              <LinkButton
                variant="ghost"
                href="https://docs.growthbook.io/sso"
                external={true}
              >
                View docs
              </LinkButton>
            </Flex>
          </Flex>
        </div>
        {generatedConfig ? (
          <div
            className={clsx("appbox", styles.cardPad)}
            style={{ marginTop: 16 }}
          >
            <Flex align="start" gap="4" mb="3">
              <Box flexGrow="1" minWidth="0">
                <div className={styles.cardTitle}>Your SSO configuration</div>
                <div className={styles.cardSubtitle}>
                  Set this environment variable on your GrowthBook server and
                  restart it. SSO also requires an active LICENSE_KEY.
                </div>
              </Box>
              <LinkButton
                variant="ghost"
                href={getSSOProviderDocsUrl(generatedConfig.idpType)}
                external={true}
              >
                {generatedConfigIdpLabel
                  ? `${generatedConfigIdpLabel} setup docs`
                  : "View docs"}
              </LinkButton>
            </Flex>
            <Code
              language="bash"
              code={`SSO_CONFIG='${generatedConfig.value.replace(
                /'/g,
                `'\\''`,
              )}'`}
              filename=".env"
            />
            <Callout status="warning" mt="3">
              This configuration is not saved in GrowthBook and will disappear
              when you leave this page &mdash; copy it now. It includes your
              client secret, so store it securely.
            </Callout>
          </div>
        ) : null}
      </>
    );
  }

  const idpLabel =
    SSO_IDP_TYPE_OPTIONS.find((o) => o.value === connection.idpType)?.label ||
    connection.idpType ||
    "";
  const lastUpdated = connection.dateUpdated || connection.dateCreated;
  const enforceLocked = !data.enforceSSO && !data.loggedInViaConnection;
  const managedByEnv = !!data.managedByEnv;

  return (
    <>
      {editOpen && hasSSOFeature && !managedByEnv ? (
        <EditSSOConnectionModal
          close={() => setEditOpen(false)}
          current={connection}
          onSave={() => {
            setEditOpen(false);
            mutate();
          }}
        />
      ) : null}
      {removeOpen ? (
        <ModalStandard
          trackingEventModalType="remove-sso-connection"
          open={true}
          close={() => setRemoveOpen(false)}
          header="Remove SSO Connection"
          cta="Remove connection"
          ctaColor="red"
          size="md"
          submit={async () => {
            await apiCall("/sso-connection", { method: "DELETE" });
            setRemoveOpen(false);
            mutate();
          }}
        >
          <p>
            Are you sure you want to remove your organization&apos;s SSO
            connection?
          </p>
          <ul>
            <li>
              Members will no longer be able to sign in through your identity
              provider and will use standard GrowthBook sign-in instead.
            </li>
            {data.enforceSSO ? (
              <li>SSO enforcement will be turned off for your organization.</li>
            ) : null}
            <li>
              Nothing changes in your identity provider &mdash; you can remove
              the GrowthBook app there separately.
            </li>
          </ul>
          <Callout status="warning">
            This takes effect within 30 seconds and cannot be undone. You will
            need to re-enter your provider details to set up SSO again.
          </Callout>
        </ModalStandard>
      ) : null}
      {!hasSSOFeature && !managedByEnv ? (
        <Callout status="warning" mb="3">
          Your current plan does not include SSO. Members can still sign in
          through your existing connection, but managing it requires an
          Enterprise plan.
        </Callout>
      ) : null}
      <div className="appbox" style={{ marginBottom: 16 }}>
        <Flex align="center" gap="4" className={styles.cardPad}>
          <Box flexGrow="1" minWidth="0">
            <Flex align="center" gap="2">
              <span className={styles.cardTitle}>Enterprise SSO</span>
              <Badge
                label={
                  <>
                    <span className={styles.statusDot} />
                    Enabled
                  </>
                }
                color="green"
                variant="soft"
              />
            </Flex>
            <div className={styles.cardSubtitle}>
              {idpLabel
                ? `Connected to ${idpLabel} via OpenID Connect`
                : "Connected via OpenID Connect"}
            </div>
          </Box>
          <Flex align="center" gap="2" flexShrink="0">
            <Button variant="ghost" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Hide full config" : "View full config"}
            </Button>
            {!managedByEnv ? (
              <>
                <Button
                  variant="outline"
                  disabled={!hasSSOFeature}
                  onClick={() => setEditOpen(true)}
                >
                  Edit connection
                </Button>
                <Button
                  variant="ghost"
                  color="red"
                  onClick={() => setRemoveOpen(true)}
                >
                  Remove
                </Button>
              </>
            ) : null}
          </Flex>
        </Flex>
        <div className={styles.detailsGrid}>
          {idpLabel ? (
            <DetailRow label="Identity provider">{idpLabel}</DetailRow>
          ) : null}
          <DetailRow label="Client ID">
            <span className={styles.mono}>{connection.clientId}</span>
          </DetailRow>
          {connection.baseURL ? (
            <DetailRow label="Base URL">
              <span className={styles.mono}>{connection.baseURL}</span>
            </DetailRow>
          ) : null}
          {connection.tenantId ? (
            <DetailRow label="Tenant ID">
              <span className={styles.mono}>{connection.tenantId}</span>
            </DetailRow>
          ) : null}
          <DetailRow label="Email domains">
            {connection.emailDomains?.length ? (
              connection.emailDomains.join(", ")
            ) : (
              <span className={styles.subtle}>
                None &mdash; members must be invited manually
              </span>
            )}
          </DetailRow>
          {lastUpdated ? (
            <DetailRow label="Last updated">{datetime(lastUpdated)}</DetailRow>
          ) : null}
        </div>
        {expanded && (
          <div className={styles.cardSection}>
            <Code language="json" code={JSON.stringify(connection, null, 2)} />
          </div>
        )}
        {managedByEnv ? (
          <div className={styles.cardNote}>
            This connection is managed by the <code>SSO_CONFIG</code>{" "}
            environment variable on your server and cannot be edited here.
          </div>
        ) : null}
      </div>
      {managedByEnv ? (
        <ScimCard />
      ) : (
        <>
          <div className={clsx("appbox", styles.cardPad)}>
            <Flex align="start" gap="4">
              <Box flexGrow="1" minWidth="0">
                <div className={styles.settingTitle}>Enforce SSO sign-in</div>
                <div className={styles.cardSubtitle}>
                  Require all members of your organization to sign in through
                  this SSO connection.
                </div>
              </Box>
              <Switch
                mt="1"
                value={data.enforceSSO}
                disabled={enforceLocked || (!hasSSOFeature && !data.enforceSSO)}
                onChange={async (enforce) => {
                  setEnforceError("");
                  try {
                    await apiCall("/sso-connection/enforce", {
                      method: "POST",
                      body: JSON.stringify({ enforce }),
                    });
                  } catch (e) {
                    setEnforceError(e.message);
                  }
                  mutate();
                }}
              />
            </Flex>
            {hasSSOFeature && enforceLocked ? (
              <Callout status="info" mt="3">
                You can enforce SSO sign-in after you have signed in through
                this connection yourself.
              </Callout>
            ) : null}
            {enforceError ? (
              <Callout status="error" mt="2">
                {enforceError}
              </Callout>
            ) : null}
          </div>
          <ScimCard />
        </>
      )}
    </>
  );
}
