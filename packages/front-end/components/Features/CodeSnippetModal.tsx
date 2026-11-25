import type { Revision } from "shared/enterprise";
import React, {
  useState,
  useEffect,
  ReactElement,
  ReactNode,
  useCallback,
} from "react";
import {
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import { FeatureInterface } from "shared/types/feature";
import { getLatestSDKVersion } from "shared/sdk-versioning";
import { PiPackage } from "react-icons/pi";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import Link from "@/ui/Link";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import SelectField from "@/components/Forms/SelectField";
import Table, {
  TableBody,
  TableCell,
  TableRow,
  TableRowHeaderCell,
} from "@/ui/Table";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { StopSubmit } from "@/ui/Modal/StopSubmit";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import EventIngestorRegionWarning from "@/components/SyntaxHighlighting/Snippets/EventIngestorRegionWarning";
import { useEventIngestorRegion } from "@/services/dataRegions";
import { getApiHost, getCdnHost } from "@/services/env";
import Code from "@/components/SyntaxHighlighting/Code";
import { useAttributeSchema } from "@/services/features";
import { GBHashLock } from "@/components/Icons";
import { DocLink, docUrl } from "@/components/DocLink";
import InstallationCodeSnippet from "@/components/SyntaxHighlighting/Snippets/InstallationCodeSnippet";
import GrowthBookSetupCodeSnippet from "@/components/SyntaxHighlighting/Snippets/GrowthBookSetupCodeSnippet";
import BooleanFeatureCodeSnippet from "@/components/SyntaxHighlighting/Snippets/BooleanFeatureCodeSnippet";
import CopyableCode from "@/components/Settings/CopyableCode";
import TargetingAttributeCodeSnippet from "@/components/SyntaxHighlighting/Snippets/TargetingAttributeCodeSnippet";
import CheckSDKConnectionModal from "@/components/GuidedGetStarted/CheckSDKConnectionModal";
import MultivariateFeatureCodeSnippet from "@/components/SyntaxHighlighting/Snippets/MultivariateFeatureCodeSnippet";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import SDKLanguageSelector from "./SDKConnections/SDKLanguageSelector";
import {
  getPackageRepositoryName,
  languageMapping,
} from "./SDKConnections/SDKLanguageLogo";

// A loop, not `/\/*$/`: that regex is quadratic on long runs of slashes.
function trimTrailingSlash(str: string): string {
  let end = str.length;
  while (end > 0 && str.charCodeAt(end - 1) === 47 /* "/" */) end--;
  return str.slice(0, end);
}

export function getApiBaseUrl(connection?: SDKConnectionInterface): string {
  if (connection && connection.proxy.enabled) {
    return trimTrailingSlash(
      connection.proxy.hostExternal ||
        connection.proxy.host ||
        "https://proxy.yoursite.io",
    );
  }

  return trimTrailingSlash(getCdnHost() || getApiHost());
}

const QUICK_START_SECTIONS = ["installation", "setup"];

// A modal section under a row that opens and shuts it, as a PanelSection is.
function CollapsibleSection({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box>
      <CollapseTrigger open={open} onOpenChange={setOpen}>
        <Text size="lg" weight="semibold" color="text-high">
          {title}
        </Text>
      </CollapseTrigger>
      <Collapse open={open}>
        <Box pt="3">{children}</Box>
      </Collapse>
    </Box>
  );
}

export default function CodeSnippetModal({
  close,
  feature,
  cta,
  submit,
  secondaryCTA,
  sdkConnection,
  connections,
  mutateConnections,
  includeCheck,
  allowChangingConnection,
  quickStart = false,
  saveEventTracker = true,
  onEventTrackerSaved,
}: {
  close?: () => void;
  feature?: FeatureInterface;
  featureId?: string;
  cta?: string;
  submit?: () => void;
  secondaryCTA?: ReactElement;
  sdkConnection?: SDKConnectionInterface;
  connections: SDKConnectionInterface[];
  mutateConnections: () => Promise<unknown>;
  includeCheck?: boolean;
  allowChangingConnection?: boolean;
  // Opens on installing and setting up the SDK, with the rest a click away.
  quickStart?: boolean;
  // Whether picking an event tracker is saved to the connection. Off where the
  // connection is shown as a draft or an earlier revision: the pick still
  // changes the snippet, and live is left alone.
  saveEventTracker?: boolean;
  // The revision a saved pick published, for a page that follows live.
  onEventTrackerSaved?: (revision: Revision | undefined) => void;
}) {
  const { t } = useLingui();
  const ctaText = cta === undefined ? t`Finish` : cta;
  const [currentConnectionId, setCurrentConnectionId] = useState("");
  const { apiCall } = useAuth();
  useEffect(() => {
    setCurrentConnectionId(
      currentConnectionId || sdkConnection?.id || connections?.[0]?.id || "",
    );
  }, [connections]);

  const currentConnection: SDKConnectionInterface | null =
    connections.find((c) => c.id === currentConnectionId) || null;

  const [showTestModal, setShowTestModal] = useState(false);

  const [language, setLanguage] = useState<SDKLanguage>("javascript");
  const [version, setVersion] = useState<string>(
    getLatestSDKVersion("javascript"),
  );

  const [eventTracker, setEventTracker] = useState(
    currentConnection?.eventTracker || "",
  );
  const [eventTrackerSaveError, setEventTrackerSaveError] = useState<
    string | null
  >(null);

  const settings = useOrgSettings();
  const attributeSchema = useAttributeSchema();
  const { ready: definitionsReady } = useDefinitions();
  const eventIngestorRegion = useEventIngestorRegion(
    currentConnection?.environment,
  );

  const permissionsUtil = usePermissionsUtil();
  const canUpdate = currentConnection
    ? permissionsUtil.canUpdateSDKConnection(currentConnection, {})
    : false;
  const updateEventTracker = useCallback(
    async (value: string) => {
      try {
        track("Event Tracker Selected", {
          eventTracker,
          language: currentConnection?.languages || [],
        });
        // The snippet follows the selection even if the write is refused.
        setEventTracker(value);
        setEventTrackerSaveError(null);
        if (canUpdate && currentConnectionId && saveEventTracker) {
          const res = await apiCall<{ revision?: Revision }>(
            `/sdk-connections/${currentConnectionId}`,
            {
              method: "PUT",
              body: JSON.stringify({
                eventTracker: value,
              }),
            },
          );
          onEventTrackerSaved?.(res?.revision);
        }
      } catch (e) {
        setEventTrackerSaveError(
          e instanceof Error ? e.message : t`Could not save the event tracker`,
        );
      }
    },
    [
      apiCall,
      canUpdate,
      currentConnection,
      currentConnectionId,
      eventTracker,
      saveEventTracker,
      onEventTrackerSaved,
      t,
    ],
  );
  useEffect(() => {
    if (!currentConnection) return;

    const language = currentConnection.languages[0] ?? "javascript";
    const version =
      (currentConnection?.languages?.length === 1 &&
      currentConnection?.languages?.[0] === language
        ? currentConnection?.sdkVersion
        : undefined) ?? getLatestSDKVersion(language);
    setLanguage(language);
    setVersion(version);
    setEventTracker(currentConnection?.eventTracker || "");
  }, [currentConnection]);

  if (!currentConnection || !definitionsReady) {
    return null;
  }

  const { docs, docLabel, label, packageUrl } = languageMapping[language];
  const hasProxy = currentConnection.proxy.enabled;
  const apiHost = getApiBaseUrl(currentConnection);
  const clientKey = currentConnection.key;
  const featuresEndpoint = apiHost + "/api/features/" + clientKey;
  const encryptionKey = currentConnection.encryptPayload
    ? currentConnection.encryptionKey
    : undefined;
  const hashSecureAttributes = !!currentConnection.hashSecureAttributes;
  const secureAttributes =
    attributeSchema?.filter((a) =>
      ["secureString", "secureString[]"].includes(a.datatype),
    ) || [];
  const secureAttributeCount = secureAttributes.length;
  const secureAttributeSalt = settings.secureAttributeSalt ?? "";
  const remoteEvalEnabled = !!currentConnection.remoteEvalEnabled;

  // Only the modal's submit opens the check, which then takes its place.
  if (showTestModal) {
    return (
      <CheckSDKConnectionModal
        close={() => {
          mutateConnections();
          setShowTestModal(false);
        }}
        connection={currentConnection}
        mutate={mutateConnections}
        goToNextStep={submit}
        cta={t`Finish`}
        showModalClose={false}
      />
    );
  }

  const canPickConnection = connections.length > 1 && !!allowChangingConnection;
  const hasLanguageChoice =
    currentConnection.languages.length > 1 || canPickConnection;
  const picker = (
    <Flex gap="5" wrap="wrap" align="start">
      {canPickConnection ? (
        <Box width="240px">
          <SelectField
            label={t`SDK Connection`}
            value={currentConnection.id}
            onChange={setCurrentConnectionId}
            options={connections.map((connection) => ({
              label: connection.name,
              value: connection.id,
            }))}
          />
        </Box>
      ) : null}
      <Box flexGrow="1" minWidth="0">
        <SDKLanguageSelector
          value={[language]}
          setValue={([language]) => {
            const version =
              (currentConnection?.languages?.length === 1 &&
              currentConnection?.languages?.[0] === language
                ? currentConnection?.sdkVersion
                : undefined) ?? getLatestSDKVersion(language);
            setLanguage(language);
            setVersion(version);
          }}
          multiple={false}
          includeOther={false}
          limitLanguages={currentConnection.languages}
        />
      </Box>
    </Flex>
  );

  const docName = docLabel || label;
  const intro =
    language === "other" ? (
      <Box>
        <Text as="p" mb="3">
          <Trans>
            We don&apos;t have an SDK for your language yet, but we do have
            extensive documentation if you want to build your own and contribute
            it back to the community!
          </Trans>
        </Text>
        <LinkButton href={docUrl("buildYourOwn")} variant="outline" external>
          <Trans>View documentation</Trans>
        </LinkButton>
      </Box>
    ) : (
      <Text as="p" mb="0">
        <Trans>
          Below is some starter code to integrate GrowthBook into your app. Read
          the <DocLink docSection={docs}>{docName} docs</DocLink> for more
          details.
        </Trans>
      </Text>
    );

  const saveError = eventTrackerSaveError ? (
    <Callout status="warning">
      <Trans>
        The event tracker was not saved to this SDK connection:{" "}
        {eventTrackerSaveError}
      </Trans>
    </Callout>
  ) : null;

  const configRows = [
    {
      label: t`Full API Endpoint`,
      proxied: hasProxy,
      value: featuresEndpoint,
    },
    { label: t`API Host`, proxied: hasProxy, value: apiHost },
    { label: t`Client Key`, proxied: false, value: clientKey },
    ...(encryptionKey
      ? [{ label: t`Decryption Key`, proxied: false, value: encryptionKey }]
      : []),
  ];

  const sections: { id: string; title: string; content: ReactNode }[] = [];

  if (!language.startsWith("nocode")) {
    sections.push({
      id: "config",
      title: t`${docName} Config Settings`,
      content: (
        <Table size="sm">
          <TableBody>
            {configRows.map((row) => (
              <TableRow key={row.label} align="center">
                <TableRowHeaderCell>
                  {row.label}
                  {row.proxied ? (
                    <>
                      {" "}
                      <Text size="sm" color="text-low">
                        <Trans>(proxied)</Trans>
                      </Text>
                    </>
                  ) : null}
                </TableRowHeaderCell>
                <TableCell>
                  <CopyableCode value={row.value} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ),
    });
  }

  if (language !== "other") {
    const packageRepositoryName = packageUrl
      ? getPackageRepositoryName(packageUrl)
      : "";
    sections.push({
      id: "installation",
      title: t`Installation`,
      content: (
        <>
          {language === "nextjs" ? (
            <Box mb="5">
              <Text as="p" mb="3">
                <Trans>
                  For back-end and hybrid integrations, use the official
                  GrowthBook adapter for Vercel&apos;s{" "}
                  <Link
                    href="https://flags-sdk.dev/providers/growthbook"
                    external
                  >
                    Flags SDK
                  </Link>{" "}
                  (@flags-sdk/growthbook).
                </Trans>
              </Text>
              <Callout status="info">
                <Trans>
                  Flags SDK does not run in a browser context. For front-end
                  integrations, use our <strong>React SDK</strong>.
                </Trans>
              </Callout>
            </Box>
          ) : null}
          <EventIngestorRegionWarning
            environment={currentConnection?.environment}
            eventTracker={eventTracker}
          />
          <InstallationCodeSnippet
            language={language}
            eventTracker={eventTracker}
            setEventTracker={updateEventTracker}
            apiHost={apiHost}
            apiKey={clientKey}
            encryptionKey={encryptionKey}
            remoteEvalEnabled={remoteEvalEnabled}
            eventIngestorRegion={eventIngestorRegion}
          />
          {packageUrl ? (
            <Box mt="3">
              <Link href={packageUrl} external size="sm">
                <Flex as="span" display="inline-flex" align="center" gap="1">
                  <PiPackage />
                  <Trans>View on {packageRepositoryName}</Trans>
                </Flex>
              </Link>
            </Box>
          ) : null}
        </>
      ),
    });

    sections.push({
      id: "setup",
      title: t`Setup`,
      content: (
        <GrowthBookSetupCodeSnippet
          language={language}
          version={version}
          apiHost={apiHost}
          apiKey={clientKey}
          encryptionKey={encryptionKey}
          remoteEvalEnabled={remoteEvalEnabled}
          eventTracker={eventTracker}
          setEventTracker={updateEventTracker}
          eventIngestorRegion={eventIngestorRegion}
        />
      ),
    });
  }

  if (!(language.startsWith("edge-") || language === "other")) {
    sections.push({
      id: "attributes",
      title: t`Targeting Attributes`,
      content: (
        <>
          <TargetingAttributeCodeSnippet
            language={language}
            hashSecureAttributes={hashSecureAttributes}
            secureAttributeSalt={secureAttributeSalt}
            version={version}
            eventTracker={eventTracker}
          />
          {hashSecureAttributes && secureAttributes.length > 0 ? (
            <Box mt="5">
              <Callout status="info" mb="4">
                <GBHashLock />{" "}
                <Trans>
                  This connection has <strong>secure attribute hashing</strong>{" "}
                  enabled. You must manually hash all attributes with datatype{" "}
                  <code>secureString</code> or <code>secureString[]</code> in
                  your SDK implementation code.
                </Trans>
              </Callout>
              <Text as="p" mb="2">
                <Plural
                  value={secureAttributeCount}
                  one="Your organization currently has # secure attribute which need to be hashed before using them in the SDK:"
                  other="Your organization currently has # secure attributes which need to be hashed before using them in the SDK:"
                />
              </Text>
              <Grid
                columns="max-content max-content"
                gapX="4"
                gapY="1"
                ml="2"
                mb="4"
              >
                {secureAttributes.map((a) => (
                  <React.Fragment key={a.property}>
                    <Text mono weight="semibold">
                      {a.property}
                    </Text>
                    <Text color="text-low">{a.datatype}</Text>
                  </React.Fragment>
                ))}
              </Grid>
              <Text as="p" mb="3">
                <Trans>
                  To hash an attribute, use a cryptographic library with{" "}
                  <strong>SHA-256</strong> support, and compute the SHA-256
                  hashed value of your attribute <em>plus</em> your
                  organization&apos;s secure attribute salt.
                </Trans>
              </Text>
              <Text as="p" mb="0">
                <Trans>
                  Example, using your organization&apos;s secure attribute salt:
                </Trans>
              </Text>
              {secureAttributeSalt === "" ? (
                <Callout status="warning" mt="2" size="sm">
                  <Trans>
                    Your organization has an empty salt string. Add a salt
                    string in your{" "}
                    <Link href="/settings">organization settings</Link> to
                    improve the security of hashed targeting conditions.
                  </Trans>
                </Callout>
              ) : null}
              <Code
                filename="pseudocode"
                language="javascript"
                code={`const salt = "${secureAttributeSalt}";

// hashing a secureString attribute
myAttribute = sha256(salt + myAttribute);

// hashing a secureString[] attribute
myAttributes = myAttributes.map(attribute => sha256(salt + attribute));`}
              />
              <Callout status="warning" mt="3">
                <Trans>
                  When using an insecure environment (such as a browser), do not
                  rely exclusively on hashing as a means of securing highly
                  sensitive data. Hashing is an obfuscation technique that makes
                  it very difficult, but not impossible, to extract sensitive
                  data.
                </Trans>
              </Callout>
            </Box>
          ) : null}
        </>
      ),
    });

    const valueTypeLabel = feature?.valueType || "String";
    sections.push({
      id: "usage",
      title: t`Usage`,
      content: (
        <>
          {!feature || feature.valueType === "boolean" ? (
            <>
              <Trans>On/Off feature:</Trans>
              <BooleanFeatureCodeSnippet
                language={language}
                featureId={feature?.id || "my-feature"}
              />
            </>
          ) : null}
          {language !== "nextjs" &&
          (!feature || feature.valueType !== "boolean") ? (
            <>
              <Trans>{valueTypeLabel} feature:</Trans>
              <MultivariateFeatureCodeSnippet
                valueType={feature?.valueType || "string"}
                language={language}
                featureId={feature?.id || "my-feature"}
              />
            </>
          ) : null}
        </>
      ),
    });
  }

  if (language === "nextjs") {
    sections.push({
      id: "customization",
      title: t`Further Customization`,
      content: (
        <ul>
          <li>
            <Trans>
              Set up <strong>Vercel Edge Config</strong> and use a GrowthBook{" "}
              <strong>SDK Webhook</strong> to keep feature and experiment values
              synced between GrowthBook and the web server. This eliminates
              network requests from the web server to GrowthBook.
            </Trans>
          </li>
          <li>
            <Trans>
              Implement sticky bucketing using{" "}
              <code>growthbookAdapter.setStickyBucketService()</code> for
              advanced experimentation.
            </Trans>
          </li>
          <li>
            <Trans>
              Expose GrowthBook data to Vercel&apos;s Flags Explorer by creating
              an API route with <code>createFlagsDiscoveryEndpoint</code>.
            </Trans>
          </li>
        </ul>
      ),
    });
  }

  return (
    <ModalStandard
      open={true}
      trackingEventModalType=""
      header={t`Implementation Instructions`}
      size="max"
      // The event tracker saves as it is picked; refresh once, on the way out.
      close={() => {
        mutateConnections();
        close?.();
      }}
      closeCta={quickStart ? t`Close` : undefined}
      cta={ctaText}
      secondaryAction={secondaryCTA}
      submit={
        includeCheck
          ? () => {
              setShowTestModal(true);
              // Stays open until the check replaces it.
              throw new StopSubmit();
            }
          : submit
      }
    >
      <Flex direction="column" gap="5">
        {quickStart ? (
          // The connection's SDK is known; choosing only matters among several.
          hasLanguageChoice ? (
            picker
          ) : null
        ) : (
          <Flex direction="column" gap="3">
            {picker}
            {intro}
          </Flex>
        )}
        {saveError}
        {sections.map((section) => (
          <CollapsibleSection
            key={section.id}
            title={section.title}
            defaultOpen={
              !quickStart || QUICK_START_SECTIONS.includes(section.id)
            }
          >
            {section.content}
          </CollapsibleSection>
        ))}
      </Flex>
    </ModalStandard>
  );
}
