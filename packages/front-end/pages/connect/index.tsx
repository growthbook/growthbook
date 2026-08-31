import { useCallback, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { SDKLanguage } from "shared/types/sdk-connection";
import { ApiSetupRun } from "shared/validators";
import {
  PiArrowRight,
  PiCaretDownBold,
  PiPaperPlaneTiltFill,
} from "react-icons/pi";
import Code from "@/components/SyntaxHighlighting/Code";
import { DocLink } from "@/components/DocLink";
import SDKLanguageLogo, {
  languageMapping,
} from "@/components/Features/SDKConnections/SDKLanguageLogo";
import PageHead from "@/components/Layout/PageHead";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import LinkButton from "@/ui/LinkButton";
import { Select, SelectItem } from "@/ui/Select";
import SplitButton from "@/ui/SplitButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Text from "@/ui/Text";
import useApi from "@/hooks/useApi";
import { useEnvironments } from "@/services/features";
import { useUser } from "@/services/UserContext";

// The languages worth offering up front. The wizard supports every target
// GrowthBook has and detects whichever the project actually is, so this list is a
// shortcut rather than a limit.
const OFFERED: SDKLanguage[] = [
  "react",
  "nextjs",
  "nodejs",
  "javascript",
  "python",
  "go",
  "ruby",
  "php",
  "csharp",
  "java",
  "ios",
  "android",
  "flutter",
  "other",
];

const PACKAGE = "growthbook-install";

/**
 * Where the command can be handed to an agent.
 *
 * The prefilled text is the bare command, not the `!` shell form. A leading `!`
 * only enters shell mode when a person types it; prefilled into a composer it stays
 * literal and Enter would send it as a prompt. Copy/paste is the other way round —
 * you are typing when you paste — so the clipboard gets the `!` form.
 */
type Target = {
  id: string;
  label: string;
  detail: string;
  group: "Claude" | "Other agents";
  href?: (command: string) => string;
};

const TARGETS: Target[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    detail: "Opens the CLI",
    group: "Claude",
    href: (c) => `claude-cli://open?q=${encodeURIComponent(c)}`,
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    detail: "Opens the desktop app",
    group: "Claude",
    href: (c) => `claude://new?q=${encodeURIComponent(c)}`,
  },
  {
    id: "claude-web",
    label: "claude.ai",
    detail: "Opens in your browser",
    group: "Claude",
    href: (c) => `https://claude.ai/new?q=${encodeURIComponent(c)}`,
  },
  {
    id: "cursor",
    label: "Cursor",
    detail: "Opens Cursor",
    group: "Other agents",
    href: () => "cursor://",
  },
  {
    id: "codex",
    label: "Codex",
    detail: "Copy it and paste into Codex",
    group: "Other agents",
  },
];

export default function ConnectPage() {
  const { userId } = useUser();
  const environments = useEnvironments();
  const [language, setLanguage] = useState<SDKLanguage>("react");
  const [openedVia, setOpenedVia] = useState("");

  // No connection exists yet — the command creates it — so the environment shown
  // is the one this org would default to, not one read off a connection.
  const environment = environments[0]?.id || "dev";
  const docs = languageMapping[language]?.docs;

  const command = useMemo(
    () =>
      language === "other"
        ? `npx ${PACKAGE}`
        : `npx ${PACKAGE} --language ${language}`,
    [language],
  );

  // The wizard opens a setup run as soon as it has something to report, so a run by
  // this user is the signal the command actually started.
  const { data: runsData } = useApi<{ setupRuns: ApiSetupRun[] }>(
    "/setup-runs",
    {
      refreshInterval: 5000,
    },
  );
  const latestRun = useMemo(
    () =>
      (runsData?.setupRuns || []).find((r) => r.createdBy === userId) || null,
    [runsData, userId],
  );

  const openTarget = useCallback(
    (target: Target) => {
      setOpenedVia(target.label);
      if (target.href) window.location.href = target.href(command);
    },
    [command],
  );

  const primary = TARGETS[0];

  return (
    <div className="container pagecontents" style={{ maxWidth: 885 }}>
      <PageHead
        breadcrumb={[{ display: "Get Started", href: "/getstarted" }]}
      />

      <Flex align="start" gap="3" mt="4" mb="1">
        <Heading as="h3" mb="0">
          SDK Installation Instructions for {environment} Environment
        </Heading>
        <Box ml="auto" style={{ flexShrink: 0 }}>
          <LinkButton
            href="/settings/team"
            variant="ghost"
            icon={<PiPaperPlaneTiltFill />}
          >
            Invite your developer
          </LinkButton>
        </Box>
      </Flex>

      <Flex align="center" gap="4" mt="3">
        <Box width="260px">
          <Select
            value={language}
            setValue={(v) => setLanguage(v as SDKLanguage)}
          >
            {OFFERED.map((id) => (
              <SelectItem key={id} value={id}>
                <SDKLanguageLogo language={id} showLabel size={25} />
              </SelectItem>
            ))}
          </Select>
        </Box>
        {docs && (
          <DocLink useRadix={false} docSection={docs}>
            View documentation <PiArrowRight />
          </DocLink>
        )}
      </Flex>

      <Tabs defaultValue="ai-assisted">
        <Box mt="4" mb="5">
          <TabsList>
            <TabsTrigger value="ai-assisted">AI-Assisted</TabsTrigger>
            <TabsTrigger value="manual">Manual Setup</TabsTrigger>
          </TabsList>
        </Box>

        <TabsContent value="ai-assisted">
          <Box mb="3">
            <Heading as="h4" size="medium" weight="semibold" mb="1">
              AI-Assisted Setup
            </Heading>
            <Text as="p" color="text-mid" mb="3">
              It signs you in, creates a new SDK connection, and can
              automatically detect attributes, fact tables, and metrics from
              your codebase.
            </Text>

            <Frame>
              <Text as="p" color="text-mid" mb="3">
                Run this command inside an AI coding agent like Claude Code or
                Cursor. This page updates on its own once it connects.
              </Text>

              <Code
                language="bash"
                code={`!${command}`}
                showLineNumbers={false}
              />

              <Flex align="center" gap="4" mt="3" wrap="wrap">
                <SplitButton
                  menu={
                    <DropdownMenu
                      trigger={
                        <Button aria-label="Choose where to open it">
                          <PiCaretDownBold />
                        </Button>
                      }
                      menuPlacement="end"
                    >
                      {(["Claude", "Other agents"] as const).map((group) => (
                        <Box key={group}>
                          <Box px="2" pt="2" pb="1">
                            <Text
                              size="small"
                              color="text-low"
                              textTransform="uppercase"
                            >
                              {group}
                            </Text>
                          </Box>
                          {TARGETS.filter((t) => t.group === group).map((t) => (
                            <DropdownMenuItem
                              key={t.id}
                              onClick={() => openTarget(t)}
                            >
                              <Flex direction="column">
                                <Text weight="medium">{t.label}</Text>
                                <Text size="small" color="text-low">
                                  {t.detail}
                                </Text>
                              </Flex>
                            </DropdownMenuItem>
                          ))}
                        </Box>
                      ))}
                    </DropdownMenu>
                  }
                >
                  <Button onClick={() => openTarget(primary)}>
                    Open in {primary.label}
                  </Button>
                </SplitButton>
                <Text size="small" color="text-low">
                  Already have an agent open? Just paste the command.
                </Text>
              </Flex>
            </Frame>

            {openedVia && (
              <Box mt="3">
                <Callout status="info">
                  Sent to {openedVia}. If nothing opened, copy the command above
                  and paste it into your agent.
                </Callout>
              </Box>
            )}

            {latestRun && (
              <Box mt="4">
                <Callout status="success">
                  Your app connected.{" "}
                  <Link href={`/setup-runs/${latestRun.id}`}>
                    See what the setup built →
                  </Link>
                </Callout>
              </Box>
            )}
          </Box>
        </TabsContent>

        <TabsContent value="manual">
          <Box mb="3">
            <Heading as="h4" size="medium" weight="semibold" mb="1">
              Manual Setup
            </Heading>
            <Text as="p" color="text-mid" mb="3">
              Install the SDK yourself and paste the client key in by hand.
            </Text>

            <Frame>
              <Text as="p" color="text-mid" mb="3">
                The installation, setup and targeting-attribute snippets are
                shown on the SDK connection itself, because each one embeds that
                connection&apos;s client key. Create the connection and they
                will be there waiting, with your key already filled in.
              </Text>
              <LinkButton href="/sdks">Create an SDK Connection</LinkButton>
            </Frame>
          </Box>
        </TabsContent>
      </Tabs>
    </div>
  );
}
