import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { SDKLanguage } from "shared/types/sdk-connection";
import { ApiSetupRun } from "shared/validators";
import { PiCheckBold, PiCaretDownBold, PiCopySimple } from "react-icons/pi";
import SDKLanguageLogo, {
  languageMapping,
} from "@/components/Features/SDKConnections/SDKLanguageLogo";
import PageHead from "@/components/Layout/PageHead";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import LinkButton from "@/ui/LinkButton";
import RadioCards from "@/ui/RadioCards";
import SplitButton from "@/ui/SplitButton";
import Text from "@/ui/Text";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";

// The languages worth putting on a first screen. The wizard itself supports every
// target GrowthBook has, so "Something else" is not a dead end — it detects whatever
// the project actually is. Showing all 25 here would bury the eight that cover almost
// everyone.
const FEATURED: SDKLanguage[] = [
  "react",
  "nextjs",
  "nodejs",
  "javascript",
  "python",
  "go",
  "ruby",
  "other",
];

const PACKAGE = "growthbook-install";

/**
 * Where the command can be handed to an agent.
 *
 * Claude Code takes a prompt in `q` and a working directory in `cwd`. We cannot know
 * the developer's absolute path from a hosted page, so `cwd` is left off and the agent
 * opens wherever it normally would.
 *
 * The prefilled text is the bare command, not the `!` shell form. A leading `!` only
 * enters shell mode when a person types it; prefilled into the composer it stays
 * literal and Enter would send it as a prompt. Copy/paste is the other way round — you
 * are typing when you paste — so the clipboard gets the `!` form and deep links don't.
 */
type Target = {
  id: string;
  label: string;
  detail: string;
  group: "Claude" | "Other agents";
  href?: (command: string) => string;
  copyOnly?: boolean;
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
    detail: "Copies it, then opens Cursor",
    group: "Other agents",
    href: () => "cursor://",
    copyOnly: true,
  },
  {
    id: "codex",
    label: "Codex",
    detail: "Copy it and paste into Codex",
    group: "Other agents",
    copyOnly: true,
  },
];

function StepMarker({
  n,
  state,
}: {
  n: number;
  state: "idle" | "active" | "done";
}) {
  const bg =
    state === "done"
      ? "var(--green-a3)"
      : state === "active"
        ? "var(--violet-9)"
        : "var(--violet-a3)";
  const fg =
    state === "done"
      ? "var(--green-11)"
      : state === "active"
        ? "white"
        : "var(--violet-11)";
  return (
    <Flex
      align="center"
      justify="center"
      style={{
        width: 23,
        height: 23,
        borderRadius: "50%",
        background: bg,
        color: fg,
        fontSize: 12,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {state === "done" ? <PiCheckBold size={11} /> : n}
    </Flex>
  );
}

function Steps({ step }: { step: 1 | 2 }) {
  const labels = ["Choose your SDK", "Run one command"];
  return (
    <Flex align="center" gap="3" mb="5">
      {labels.map((label, i) => {
        const n = i + 1;
        const state = n === step ? "active" : n < step ? "done" : "idle";
        return (
          <Flex align="center" gap="3" key={label} style={{ minWidth: 0 }}>
            {i > 0 && (
              <Box
                style={{
                  width: 40,
                  borderBottom: `1px ${n <= step ? "solid" : "dashed"} var(--gray-a7)`,
                }}
              />
            )}
            <Flex align="center" gap="2">
              <StepMarker n={n} state={state} />
              <Text
                size="medium"
                weight={state === "idle" ? "regular" : "semibold"}
                color={state === "idle" ? "text-low" : undefined}
              >
                {label}
              </Text>
            </Flex>
          </Flex>
        );
      })}
    </Flex>
  );
}

export default function ConnectPage() {
  const router = useRouter();
  const { userId } = useUser();
  const [step, setStep] = useState<1 | 2>(1);
  const [language, setLanguage] = useState<string>("");
  const [openedVia, setOpenedVia] = useState("");
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1800,
  });

  const command = useMemo(
    () =>
      language && language !== "other"
        ? `npx ${PACKAGE} --language ${language}`
        : `npx ${PACKAGE}`,
    [language],
  );

  // The clipboard gets the shell-mode prefix; see the note on Target above.
  const toCopy = `!${command}`;

  // The wizard opens a setup run as soon as it has something to report, so a new run
  // by this user is the signal that the command actually started. Only poll while
  // waiting — this page is otherwise static.
  const { data: runsData } = useApi<{ setupRuns: ApiSetupRun[] }>(
    "/setup-runs",
    {
      shouldRun: () => step === 2,
      refreshInterval: step === 2 ? 4000 : 0,
    },
  );

  // Anything already there when we started waiting is a previous run, not this one.
  const [knownRunIds, setKnownRunIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (step !== 2 || knownRunIds !== null || !runsData) return;
    setKnownRunIds(runsData.setupRuns.map((r) => r.id));
  }, [step, knownRunIds, runsData]);

  const freshRun = useMemo(() => {
    if (!runsData || knownRunIds === null) return null;
    return (
      runsData.setupRuns.find(
        (r) => r.createdBy === userId && !knownRunIds.includes(r.id),
      ) || null
    );
  }, [runsData, knownRunIds, userId]);

  const openTarget = useCallback(
    (target: Target) => {
      if (target.copyOnly) performCopy(toCopy);
      setOpenedVia(target.label);
      if (target.href) window.location.href = target.href(command);
    },
    [command, toCopy, performCopy],
  );

  const primary = TARGETS[0];

  return (
    <div className="contents container pagecontents">
      <PageHead
        breadcrumb={[{ display: "Get Started", href: "/getstarted" }]}
      />

      <Steps step={step} />

      {step === 1 ? (
        <>
          <Heading as="h1" size="2x-large" mb="2">
            Connect GrowthBook to Your App
          </Heading>
          <Box mb="5" style={{ maxWidth: "66ch" }}>
            <Text size="medium" color="text-mid" as="div">
              Pick the SDK your project uses. One command then signs you in,
              creates the connection and the client key, installs the SDK and
              wires it up — nothing to copy into a config file by hand.
            </Text>
          </Box>

          <RadioCards
            columns="4"
            align="center"
            value={language}
            setValue={setLanguage}
            options={FEATURED.map((id) => ({
              value: id,
              label: languageMapping[id]?.label || id,
              avatar: (
                <SDKLanguageLogo language={id} showLabel={false} size={26} />
              ),
            }))}
          />

          <Flex align="center" gap="4" mt="5" wrap="wrap">
            <Button disabled={!language} onClick={() => setStep(2)}>
              Continue
            </Button>
            <Text size="small" color="text-low">
              {language
                ? `${languageMapping[language as SDKLanguage]?.label || language} it is — hit Continue.`
                : "Select an SDK to continue."}
            </Text>
            <Box ml="auto">
              <LinkButton href="/datasources" variant="outline">
                Connect your warehouse
              </LinkButton>
            </Box>
          </Flex>
        </>
      ) : (
        <>
          <Heading as="h1" size="2x-large" mb="2">
            Run This in Your Project
          </Heading>
          <Box mb="5" style={{ maxWidth: "66ch" }}>
            <Text size="medium" color="text-mid" as="div">
              One command signs you in, creates the SDK connection, installs the{" "}
              {languageMapping[language as SDKLanguage]?.label || "SDK"} SDK and
              wires it up. Paste it into Claude Code, Cursor, or any coding
              agent.
            </Text>
          </Box>

          <Flex
            align="center"
            gap="3"
            p="4"
            mb="4"
            style={{
              background: "var(--slate-12)",
              borderRadius: "var(--radius-3)",
              fontFamily: "var(--code-font-family, monospace)",
              overflowX: "auto",
            }}
          >
            <Box style={{ color: "var(--slate-8)", flexShrink: 0 }}>
              <Text size="medium">$</Text>
            </Box>
            <Box
              style={{
                flex: 1,
                minWidth: 0,
                whiteSpace: "nowrap",
                color: "var(--slate-1)",
              }}
            >
              <Text size="medium">{toCopy}</Text>
            </Box>
            {copySupported && (
              <Button
                variant="soft"
                size="xs"
                icon={copySuccess ? <PiCheckBold /> : <PiCopySimple />}
                onClick={() => performCopy(toCopy)}
              >
                {copySuccess ? "Copied" : "Copy"}
              </Button>
            )}
          </Flex>

          <Flex align="center" gap="4" wrap="wrap">
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
            <Box style={{ maxWidth: "30ch" }}>
              <Text size="small" color="text-low">
                Already have an agent open? Just paste the command.
              </Text>
            </Box>
          </Flex>

          {openedVia && (
            <Box mt="4" style={{ maxWidth: 560 }}>
              <Callout status="info">
                Sent to {openedVia}. If nothing opened, the command is on your
                clipboard — paste it into your agent.
              </Callout>
            </Box>
          )}

          <Separator size="4" my="5" />

          {freshRun ? (
            <Callout status="success">
              Your app connected.{" "}
              <a href={`/setup-runs/${freshRun.id}`}>
                See what the setup built →
              </a>
            </Callout>
          ) : (
            <Flex align="center" gap="3">
              <Box
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--violet-9)",
                  flexShrink: 0,
                }}
              />
              <Text size="small" color="text-low">
                Waiting for your app to connect… this page updates on its own.
              </Text>
            </Flex>
          )}

          <Flex align="center" gap="3" mt="5">
            <Button variant="ghost" onClick={() => setStep(1)}>
              ← Back
            </Button>
            <Box ml="auto">
              <LinkButton href="/sdks" variant="ghost">
                Skip, I&apos;ll do it by hand
              </LinkButton>
            </Box>
          </Flex>
        </>
      )}

      <Box mt="6">
        <Frame>
          <Text size="small" color="text-mid" as="div">
            The command works on every SDK GrowthBook supports, not just the
            eight above — it reads your project and picks the right one. Nothing
            is installed until you run it.
          </Text>
        </Frame>
      </Box>

      {/* Keeps the router import honest: the success callout is a link, but a run that
          appears while the tab is backgrounded should still be reachable on return. */}
      {freshRun && router.query.autofollow === "1" ? (
        <meta
          httpEquiv="refresh"
          content={`0;url=/setup-runs/${freshRun.id}`}
        />
      ) : null}
    </div>
  );
}
