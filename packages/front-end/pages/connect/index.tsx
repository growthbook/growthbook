import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { Box, Container, Flex, Separator } from "@radix-ui/themes";
import { SDKLanguage } from "shared/types/sdk-connection";
import {
  PiCaretLeftBold,
  PiCaretRightBold,
  PiInfo,
  PiPaperPlaneTiltFill,
} from "react-icons/pi";
import Code from "@/components/SyntaxHighlighting/Code";
import { getApiBaseUrl } from "@/components/Features/CodeSnippetModal";
import InstallationCodeSnippet from "@/components/SyntaxHighlighting/Snippets/InstallationCodeSnippet";
import SDKLanguageSelector from "@/components/Features/SDKConnections/SDKLanguageSelector";
import { LanguageFilter } from "@/components/Features/SDKConnections/SDKLanguageLogo";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import useFeaturesSettled from "@/hooks/useFeaturesSettled";
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

  // Off by default: without the flag this page does not exist, and the existing
  // setup wizard takes over.
  useEffect(() => {
    if (flagsSettled && !aiOnboarding) router.replace("/setup");
  }, [flagsSettled, aiOnboarding, router]);

  const apiHost = getApiBaseUrl();
  const wizardable = !NO_WIZARD.has(language);
  const command = `npx ${PACKAGE} --language ${language} --${agent}${organization.id ? ` --org ${organization.id}` : ""}`;
  const agentLabel = AGENTS.find((a) => a.id === agent)?.label ?? "your agent";

  if (!flagsSettled) return <LoadingOverlay />;
  if (!aiOnboarding) return null;

  const manual = (
    <>
      {!wizardable && (
        <Box mb="3">
          <Callout status="info">
            Follow the manual setup instructions for this SDK.
          </Callout>
        </Box>
      )}
      <Frame p="4" mb="0">
        {/* apiKey is read only by this component's script-tag branch. Where it
                matters the key is public by design; elsewhere it is unused, so an
                empty value invents nothing. The snippets that embed a real key
                live on the SDK connection itself. */}
        <InstallationCodeSnippet
          language={language}
          apiKey=""
          apiHost={apiHost}
          remoteEvalEnabled={false}
          eventTracker={eventTracker}
          setEventTracker={setEventTracker}
        />
      </Frame>
      <Box mt="3">
        <Text as="p" color="text-mid" mb="3">
          Create an SDK Connection to get your client key and configuration
          instructions.
        </Text>
        <LinkButton href="/sdks" variant="outline">
          Create an SDK Connection
        </LinkButton>
      </Box>
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
            <LinkButton href="/getstarted" variant="ghost">
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
