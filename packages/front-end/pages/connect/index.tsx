import { useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
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
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import LinkButton from "@/ui/LinkButton";
import { Select, SelectItem } from "@/ui/Select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { useUser } from "@/services/UserContext";

const PACKAGE = "growthbook-install";

// Ids match the launcher's --agent values; the flag on the command is `--${id}`.
const AGENTS = [
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "opencode" },
  { id: "gemini", label: "Gemini CLI" },
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
  const [step, setStep] = useState<1 | 2>(1);
  const [language, setLanguage] = useState<SDKLanguage>("react");
  const [languageFilter, setLanguageFilter] =
    useState<LanguageFilter>("popular");
  // InstallationCodeSnippet owns the GTM/GrowthBook tracker choice for its script-tag
  // paths; the props are required even where that choice does not apply.
  const [eventTracker, setEventTracker] = useState("");
  const [agent, setAgent] = useState<AgentId>("claude");

  const apiHost = getApiBaseUrl();
  const wizardable = !NO_WIZARD.has(language);
  const command = `npx ${PACKAGE} --language ${language} --${agent}${organization.id ? ` --org ${organization.id}` : ""}`;
  const agentLabel = AGENTS.find((a) => a.id === agent)?.label ?? "your agent";

  return (
    <div className="container pagecontents" style={{ maxWidth: 885 }}>
      <PageHead
        breadcrumb={[{ display: "Get Started", href: "/getstarted" }]}
      />

      <Flex align="start" gap="3" mt="4" mb="5">
        <Box>
          <Heading as="h1" size="2x-large" mb="1">
            Connect Your SDK
          </Heading>
          <Text as="p" color="text-mid">
            {step === 1
              ? "Select your SDK language."
              : "Install the GrowthBook SDK in your app to start running feature flags and experiments."}
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
      ) : (
        <Tabs defaultValue={wizardable ? "ai-assisted" : "manual"}>
          <Box mb="5">
            <TabsList>
              {wizardable && (
                <TabsTrigger value="ai-assisted">AI-Assisted</TabsTrigger>
              )}
              <TabsTrigger value="manual">Manual Setup</TabsTrigger>
            </TabsList>
          </Box>

          {wizardable && (
            <TabsContent value="ai-assisted">
              <Flex align="center" gap="2" mb="3">
                <Heading as="h4" size="medium" weight="semibold" mb="0">
                  AI-Assisted Setup
                </Heading>
                <Tooltip content="It signs you in, creates an SDK connection and installs the SDK, then hands over to your coding agent to wire it up, find targeting attributes in your code, and put something behind a first flag.">
                  <Box style={{ color: "var(--slate-9)", display: "flex" }}>
                    <PiInfo size={16} />
                  </Box>
                </Tooltip>
              </Flex>

              <Box
                p="4"
                style={{
                  background: "var(--violet-a2)",
                  borderRadius: "var(--radius-3)",
                }}
              >
                <Box mb="3" maxWidth="240px">
                  <Select
                    label="Coding agent"
                    value={agent}
                    setValue={(v) => {
                      const next = AGENTS.find((a) => a.id === v);
                      if (next) setAgent(next.id);
                    }}
                    size="small"
                  >
                    {AGENTS.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </Select>
                </Box>
                <Text as="p" color="text-mid" mb="3">
                  Run this in a terminal in your project. It signs you in,
                  installs the SDK, and{" "}
                  {agent === "gemini"
                    ? "prints the prompt for Gemini CLI."
                    : `opens ${agentLabel} with the rest.`}
                </Text>
                <Code
                  language="bash"
                  code={command}
                  showLineNumbers={false}
                  filename="Terminal"
                />
              </Box>
            </TabsContent>
          )}

          <TabsContent value="manual">
            {!wizardable && (
              <Box mb="3">
                <Callout status="info">
                  This one is set up by hand — there is no package to install,
                  so the AI-assisted path does not apply.
                </Callout>
              </Box>
            )}
            <Box
              p="4"
              style={{
                background: "var(--violet-a2)",
                borderRadius: "var(--radius-3)",
              }}
            >
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
            </Box>
            <Box mt="3">
              <Text as="p" color="text-mid" mb="3">
                That installs the SDK. Initialising it needs your client key,
                which belongs to an SDK connection — create one and its setup
                snippets arrive with the key already filled in.
              </Text>
              <LinkButton href="/sdks" variant="outline">
                Create an SDK Connection
              </LinkButton>
            </Box>
          </TabsContent>
        </Tabs>
      )}

      <Separator size="4" my="6" />

      <Flex align="center" gap="3">
        {step === 2 && (
          <Button variant="ghost" onClick={() => setStep(1)}>
            <PiCaretLeftBold /> Back
          </Button>
        )}
        <Box ml="auto">
          <Flex align="center" gap="4">
            <LinkButton href="/getstarted" variant="ghost">
              Skip
            </LinkButton>
            {step === 1 && (
              <Button onClick={() => setStep(2)}>
                Next <PiCaretRightBold />
              </Button>
            )}
          </Flex>
        </Box>
      </Flex>
    </div>
  );
}
