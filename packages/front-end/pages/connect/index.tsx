import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { Box, Container, Flex, Separator } from "@radix-ui/themes";
import {
  CreateSDKConnectionParams,
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import { getLatestSDKVersion, getSDKCapabilities } from "shared/sdk-versioning";
import {
  PiCaretLeftBold,
  PiCaretRightBold,
  PiInfo,
  PiPaperPlaneTiltFill,
} from "react-icons/pi";
import Code from "@/components/SyntaxHighlighting/Code";
import { getApiBaseUrl } from "@/components/Features/CodeSnippetModal";
import InstallationCodeSnippet from "@/components/SyntaxHighlighting/Snippets/InstallationCodeSnippet";
import GrowthBookSetupCodeSnippet from "@/components/SyntaxHighlighting/Snippets/GrowthBookSetupCodeSnippet";
import TargetingAttributeCodeSnippet from "@/components/SyntaxHighlighting/Snippets/TargetingAttributeCodeSnippet";
import SDKLanguageSelector from "@/components/Features/SDKConnections/SDKLanguageSelector";
import {
  LanguageFilter,
  languageMapping,
} from "@/components/Features/SDKConnections/SDKLanguageLogo";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import useFeaturesSettled from "@/hooks/useFeaturesSettled";
import useSDKConnections from "@/hooks/useSDKConnections";
import useOrgSettings from "@/hooks/useOrgSettings";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import LinkButton from "@/ui/LinkButton";
import { Select, SelectItem } from "@/ui/Select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAttributeSchema, useEnvironments } from "@/services/features";
import track from "@/services/track";

const PACKAGE = "@growthbook/wizard";

// Ids match the launcher's --agent values; the flag on the command is `--${id}`.
const AGENTS = [
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "opencode" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "antigravity", label: "Antigravity" },
] as const;
type AgentId = (typeof AGENTS)[number]["id"];

// The wizard installs a package and then proves it landed. For a script tag or a
// hand-copied BrightScript file there is nothing to install and nothing to verify,
// so those languages get the manual instructions only — the AI-Assisted tab would be
// offering to run a command that cannot do anything.
const NO_WIZARD: ReadonlySet<string> = new Set([
  "nocode-webflow",
  "nocode-wordpress",
  "nocode-shopify",
  "nocode-other",
  "roku",
  "other",
]);

export default function ConnectPage() {
  const { organization } = useUser();
  const router = useRouter();
  const aiOnboarding = useFeatureIsOn("ai-assisted-onboarding");
  const flagsSettled = useFeaturesSettled();
  const [step, setStep] = useState<1 | 2>(1);
  const [language, setLanguage] = useState<SDKLanguage>("react");
  const [languageFilter, setLanguageFilter] =
    useState<LanguageFilter>("popular");
  // InstallationCodeSnippet owns the GTM/GrowthBook tracker choice for its script-tag
  // paths; the props are required even where that choice does not apply.
  const [eventTracker, setEventTracker] = useState("");
  const [agent, setAgent] = useState<AgentId>("claude");

  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const { mutateDefinitions, eventIngestorRegion } = useDefinitions();
  const { data: sdkData, mutate: mutateSdkConnections } = useSDKConnections();
  const environments = useEnvironments();
  const settings = useOrgSettings();
  const attributeSchema = useAttributeSchema();

  const connection: SDKConnectionInterface | null =
    sdkData?.connections.find((c) => c.languages.includes(language)) ?? null;
  const [creatingConnection, setCreatingConnection] = useState(false);
  const createdFor = useRef<string | null>(null);

  // The manual instructions are only real with a client key in them, so the
  // connection is created on the way to step 2 — the same point the setup wizard
  // creates its own. gb-connect reuses this one, so the agent path is unaffected.
  useEffect(() => {
    if (step !== 2 || !sdkData || connection) return;
    if (createdFor.current === language) return;
    createdFor.current = language;

    const capabilities = getSDKCapabilities(language);
    const canUseSecureConnection =
      hasCommercialFeature("hash-secure-attributes") &&
      capabilities.includes("encryption");

    const body: Omit<CreateSDKConnectionParams, "organization"> = {
      name: `${languageMapping[language].label} SDK Connection`,
      languages: [language],
      sdkVersion: getLatestSDKVersion(language),
      environment: environments[0]?.id || "production",
      projects: [],
      encryptPayload: canUseSecureConnection,
      hashSecureAttributes: canUseSecureConnection,
      includeExperimentNames: !canUseSecureConnection,
      includeDraftExperiments: true,
      includeVisualExperiments: capabilities.includes("visualEditorJS"),
      includeRedirectExperiments: capabilities.includes("redirects"),
      includeRuleIds: true,
      includeProjectIdInMetadata: false,
      includeCustomFieldsInMetadata: false,
      allowedCustomFieldsInMetadata: [],
      includeTagsInMetadata: false,
    };

    setCreatingConnection(true);
    apiCall<{ connection: SDKConnectionInterface }>("/sdk-connections", {
      method: "POST",
      body: JSON.stringify(body),
    })
      .then(async () => {
        track("Create SDK Connection", {
          source: "connect",
          languages: [language],
          ciphered: canUseSecureConnection,
          environment: body.environment,
        });
        await mutateSdkConnections();
        await mutateDefinitions();
      })
      .catch(() => {
        // Let them create it by hand instead; nothing else on the page needs it.
        createdFor.current = null;
      })
      .finally(() => setCreatingConnection(false));
  }, [
    step,
    sdkData,
    connection,
    language,
    environments,
    hasCommercialFeature,
    apiCall,
    mutateSdkConnections,
    mutateDefinitions,
  ]);

  // Off by default: without the flag this page does not exist, and the existing
  // setup wizard takes over.
  useEffect(() => {
    if (flagsSettled && !aiOnboarding) router.replace("/setup");
  }, [flagsSettled, aiOnboarding, router]);

  const apiHost = getApiBaseUrl(connection ?? undefined);
  // Same contract as the setup wizard, so arriving from Features returns there.
  const exitHref =
    router.query.exitLocation === "features" ? "/features" : "/getstarted";
  const wizardable = !NO_WIZARD.has(language);
  const command = `npx ${PACKAGE} --language ${language} --${agent}${organization.id ? ` --org ${organization.id}` : ""}`;
  const agentLabel = AGENTS.find((a) => a.id === agent)?.label ?? "your agent";

  if (!flagsSettled) return <LoadingOverlay />;
  if (!aiOnboarding) return null;

  const encryptionKey = connection?.encryptPayload
    ? connection.encryptionKey
    : undefined;
  const remoteEvalEnabled = connection?.remoteEvalEnabled || false;
  const hashSecureAttributes = !!connection?.hashSecureAttributes;
  const secureAttributeSalt = settings.secureAttributeSalt ?? "";
  const secureAttributes = attributeSchema.filter((a) =>
    ["secureString", "secureString[]"].includes(a.datatype),
  );

  const manual = (
    <>
      {!wizardable && (
        <Box mb="3">
          <Callout status="info">
            Follow the manual setup instructions for this SDK.
          </Callout>
        </Box>
      )}
      {!connection ? (
        <Frame p="4" mb="0">
          <Text as="p" color="text-mid" mb="0">
            {creatingConnection
              ? "Setting up your SDK Connection…"
              : "An SDK Connection is needed for these instructions."}
          </Text>
          {!creatingConnection && (
            <Box mt="3">
              <LinkButton href="/sdks" variant="outline">
                Create an SDK Connection
              </LinkButton>
            </Box>
          )}
        </Frame>
      ) : (
        <>
          <Heading as="h3" size="md" weight="semibold" mb="2">
            Installation
          </Heading>
          <Frame p="4" mb="5">
            <InstallationCodeSnippet
              language={language}
              eventTracker={eventTracker}
              setEventTracker={setEventTracker}
              apiHost={apiHost}
              apiKey={connection.key}
              encryptionKey={encryptionKey}
              remoteEvalEnabled={remoteEvalEnabled}
              eventIngestorRegion={eventIngestorRegion}
            />
          </Frame>

          {language !== "other" && (
            <>
              <Heading as="h3" size="md" weight="semibold" mb="2">
                Setup
              </Heading>
              <Frame p="4" mb="5">
                <GrowthBookSetupCodeSnippet
                  language={language}
                  version={connection.sdkVersion}
                  apiHost={apiHost}
                  apiKey={connection.key}
                  encryptionKey={encryptionKey}
                  remoteEvalEnabled={remoteEvalEnabled}
                  eventTracker={eventTracker}
                  setEventTracker={setEventTracker}
                  eventIngestorRegion={eventIngestorRegion}
                />
              </Frame>
            </>
          )}

          {!(language.match(/^edge-/) || language === "other") && (
            <>
              <Heading as="h3" size="md" weight="semibold" mb="2">
                Targeting Attributes (Optional)
              </Heading>
              <Frame p="4" mb="0">
                <TargetingAttributeCodeSnippet
                  language={language}
                  hashSecureAttributes={hashSecureAttributes}
                  secureAttributeSalt={secureAttributeSalt}
                  version={connection.sdkVersion}
                  eventTracker={eventTracker}
                />
                {hashSecureAttributes && secureAttributes.length > 0 && (
                  <Callout status="info" mt="4" mb="0">
                    This connection has{" "}
                    <strong>secure attribute hashing</strong> enabled. You must
                    manually hash all attributes with datatype{" "}
                    <code>secureString</code> or <code>secureString[]</code> in
                    your SDK implementation code.
                  </Callout>
                )}
              </Frame>
            </>
          )}
        </>
      )}
    </>
  );

  return (
    <Container
      size="3"
      px={{ initial: "2", xs: "4", sm: "7" }}
      py={{ initial: "1", xs: "3", sm: "6" }}
    >
      <PageHead
        breadcrumb={[{ display: "Get Started", href: "/getstarted" }]}
      />

      <Flex align="start" gap="3" mt="4" mb="5">
        <Box>
          <Heading as="h1" size="2xl" mb="1">
            Connect Your SDK
          </Heading>
          <Text as="p" color="text-mid">
            {step === 1
              ? "Select your SDK language."
              : "Install the GrowthBook SDK to use Feature Flags and experiments in your app."}
          </Text>
        </Box>
        {step === 2 && (
          <Box ml="auto" style={{ flexShrink: 0 }}>
            <LinkButton
              href="/settings/team"
              variant="ghost"
              icon={<PiPaperPlaneTiltFill />}
            >
              Invite a teammate
            </LinkButton>
          </Box>
        )}
      </Flex>

      {step === 1 ? (
        <SDKLanguageSelector
          value={[language]}
          setValue={([selected]) => setLanguage(selected)}
          multiple={false}
          includeOther={false}
          languageFilter={languageFilter}
          setLanguageFilter={setLanguageFilter}
        />
      ) : wizardable ? (
        <Tabs defaultValue="ai-assisted">
          <Box mb="5">
            <TabsList>
              <TabsTrigger value="ai-assisted">AI-assisted</TabsTrigger>
              <TabsTrigger value="manual">Manual setup</TabsTrigger>
            </TabsList>
          </Box>
          <TabsContent value="ai-assisted">
            <Flex align="center" gap="2" mb="3">
              <Heading as="h2" size="md" weight="semibold" mb="0">
                Wizard
              </Heading>
              <Tooltip content="The wizard installs the SDK and creates an SDK Connection. Your coding agent completes the integration and helps you add targeting attributes and a Feature Flag.">
                <Box style={{ color: "var(--slate-9)", display: "flex" }}>
                  <PiInfo size={16} />
                </Box>
              </Tooltip>
            </Flex>

            <Frame p="4" mb="0">
              <Box mb="3" maxWidth="240px">
                <Select
                  label="Coding agent"
                  value={agent}
                  setValue={(v) => {
                    const next = AGENTS.find((a) => a.id === v);
                    if (next) setAgent(next.id);
                  }}
                  size="sm"
                >
                  {AGENTS.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                    </SelectItem>
                  ))}
                </Select>
              </Box>
              <Text as="p" color="text-mid" mb="3">
                Run this command from your project directory. It signs you in,
                installs the SDK, and{" "}
                {agent === "gemini"
                  ? "prints the prompt for Gemini CLI."
                  : agent === "antigravity"
                    ? "opens Antigravity with the prompt on your clipboard."
                    : `opens ${agentLabel} to complete the integration.`}
              </Text>
              <Code
                language="bash"
                code={command}
                showLineNumbers={false}
                filename="Terminal"
              />
            </Frame>
          </TabsContent>
          <TabsContent value="manual">{manual}</TabsContent>
        </Tabs>
      ) : (
        // One choice is not a tab bar: hand-set-up targets get the manual steps alone.
        manual
      )}

      <Separator size="4" my="6" />

      <Flex align="center" gap="3">
        {step === 2 && (
          <Button
            variant="ghost"
            icon={<PiCaretLeftBold />}
            onClick={() => setStep(1)}
          >
            Back
          </Button>
        )}
        <Box ml="auto">
          <Flex align="center" gap="4">
            <LinkButton href={exitHref} variant="ghost">
              Skip
            </LinkButton>
            {step === 1 && (
              <Button
                icon={<PiCaretRightBold />}
                iconPosition="right"
                onClick={() => setStep(2)}
              >
                Next
              </Button>
            )}
          </Flex>
        </Box>
      </Flex>
    </Container>
  );
}

// Onboarding owns the whole window: the lite top bar instead of the sidebar, and
// "lite" zeroes the padding the sidebar would otherwise need.
ConnectPage.liteLayout = true;
ConnectPage.mainClassName = "lite";
