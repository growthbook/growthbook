import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import { ago, date } from "shared/dates";
import { ApiAutoRun } from "shared/validators";
import { useAuth } from "@/services/auth";
import { trackPageView } from "@/services/track";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

type Artifact = Pick<
  ApiAutoRun["artifacts"][number],
  "kind" | "id" | "label" | "by"
>;

type SandboxLinkInfo =
  | { status: "invalid" | "not-found" | "used" | "expired" }
  | {
      status: "active";
      sandbox: {
        organizationId: string;
        name: string;
        dateCreated: string;
        expiresAt: string;
        agent: string | null;
        artifacts: Artifact[];
        runUrl: string;
      };
    };

const KIND_LABEL: Record<Artifact["kind"], string> = {
  "sdk-connection": "SDK Connections",
  feature: "Feature Flags",
  experiment: "Experiments",
  attribute: "Attributes",
  metric: "Metrics",
  "fact-table": "Fact Tables",
  "saved-group": "Saved Groups",
  environment: "Environments",
  tag: "Tags",
};

const MAX_LABELS = 3;

function formatCode(raw: string): string {
  const letters = raw
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 8);
  return letters.length > 4
    ? `${letters.slice(0, 4)}-${letters.slice(4)}`
    : letters;
}

function ArtifactSummary({ artifacts }: { artifacts: Artifact[] }) {
  const groups = new Map<Artifact["kind"], string[]>();
  artifacts.forEach((a) =>
    groups.set(a.kind, [...(groups.get(a.kind) ?? []), a.label]),
  );
  return (
    <Flex direction="column" gap="1">
      {[...groups].map(([kind, labels]) => (
        <Flex key={kind} gap="3">
          <Box flexShrink="0" width="140px">
            <Text color="text-mid">
              {KIND_LABEL[kind]}
              {labels.length > MAX_LABELS ? ` (${labels.length})` : ""}
            </Text>
          </Box>
          <Text overflowWrap="anywhere">
            {labels.slice(0, MAX_LABELS).join(", ")}
            {labels.length > MAX_LABELS
              ? ` +${labels.length - MAX_LABELS} more`
              : ""}
          </Text>
        </Flex>
      ))}
    </Flex>
  );
}

const LinkPage = (): React.ReactElement => {
  const router = useRouter();
  const { apiCall, isAuthenticated, loading: authLoading } = useAuth();
  const [code, setCode] = useState("");
  const [link, setLink] = useState<SandboxLinkInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const lookup = useCallback(
    async (value: string) => {
      setChecking(true);
      setError(null);
      setLink(null);
      try {
        const res = await apiCall<{ link: SandboxLinkInfo }>(
          `/link/info?code=${encodeURIComponent(value)}`,
        );
        setLink(res.link);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setChecking(false);
      }
    },
    [apiCall],
  );

  useEffect(() => {
    trackPageView("/link");
  }, []);

  // Each lookup counts against a rate limit, so a new apiCall alone doesn't repeat it
  const lookedUp = useRef<string | null>(null);
  const fromUrl = router.query.code;
  useEffect(() => {
    if (!router.isReady || !isAuthenticated) return;
    if (typeof fromUrl !== "string" || !fromUrl) return;
    if (lookedUp.current === fromUrl) return;
    lookedUp.current = fromUrl;
    const formatted = formatCode(fromUrl);
    setCode(formatted);
    lookup(formatted);
  }, [router.isReady, isAuthenticated, fromUrl, lookup]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!code) return;
    if (code === fromUrl) {
      lookup(code);
      return;
    }
    router.replace({ pathname: router.pathname, query: { code } }, undefined, {
      shallow: true,
    });
  };

  if (authLoading || !isAuthenticated || !router.isReady) {
    return <LoadingOverlay />;
  }

  const status = link?.status;
  const inputError =
    status === "not-found"
      ? "No setup matches that code."
      : status === "invalid"
        ? "A code has eight letters, like KQBX-TQWM."
        : undefined;

  return (
    <Box maxWidth="520px" mx="auto" my="5" px="4">
      <Frame>
        {status === "used" ? (
          <>
            <Heading as="h1" size="lg" mb="2">
              This Code Was Already Used
            </Heading>
            <Text as="p" color="text-mid" mb="4">
              The setup now belongs to whoever used it.
            </Text>
            <Link href="/">Go to GrowthBook</Link>
          </>
        ) : status === "expired" ? (
          <>
            <Heading as="h1" size="lg" mb="2">
              This Code Has Expired
            </Heading>
            <Text as="p" color="text-mid" mb="4">
              The setup stopped. Run the wizard again to start a new one.
            </Text>
            <Link href="/">Go to GrowthBook</Link>
          </>
        ) : link?.status === "active" ? (
          <>
            <Heading as="h1" size="lg" mb="1">
              {link.sandbox.name}
            </Heading>
            <Text as="p" color="text-mid" mb="4">
              Started {ago(link.sandbox.dateCreated)}
              {link.sandbox.agent ? ` by ${link.sandbox.agent}` : ""} · Expires{" "}
              {date(link.sandbox.expiresAt)}
            </Text>
            {link.sandbox.artifacts.length > 0 && (
              <Box mb="4">
                <Text as="p" weight="medium" mb="2">
                  Made so far
                </Text>
                <ArtifactSummary artifacts={link.sandbox.artifacts} />
              </Box>
            )}
            <Box py="4" mb="2">
              <Text
                as="div"
                align="center"
                size="xl"
                weight="semibold"
                mono
                mb="2"
              >
                <span style={{ letterSpacing: "0.2em" }}>{code}</span>
              </Text>
              <Text as="p" align="center" color="text-mid">
                Only continue if this matches the code in your terminal.
              </Text>
            </Box>
            {acceptError && (
              <Callout status="error" mb="3">
                {acceptError}
              </Callout>
            )}
            <Flex justify="between" align="center" gap="3">
              <Button
                variant="ghost"
                onClick={() => {
                  setLink(null);
                  setAcceptError(null);
                }}
              >
                Use another code
              </Button>
              <Button
                setError={setAcceptError}
                onClick={async () => {
                  const res = await apiCall<{
                    organizationId: string;
                    runUrl: string;
                  }>("/link/accept", {
                    method: "POST",
                    body: JSON.stringify({ code }),
                  });
                  window.location.assign(
                    res.runUrl || `/?org=${res.organizationId}`,
                  );
                }}
              >
                Make it my workspace
              </Button>
            </Flex>
          </>
        ) : (
          <form onSubmit={submit}>
            <Heading as="h1" size="lg" mb="4">
              Link Your Setup
            </Heading>
            <TextField
              label="Code"
              placeholder="KQBX-TQWM"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={code}
              onChange={(e) => {
                setCode(formatCode(e.target.value));
                setLink(null);
              }}
              error={inputError}
              mb="3"
            />
            {error && (
              <Callout status="error" mb="3">
                {error}
              </Callout>
            )}
            <Flex justify="end">
              <Button type="submit" loading={checking} disabled={!code}>
                Continue
              </Button>
            </Flex>
          </form>
        )}
      </Frame>
    </Box>
  );
};

LinkPage.noOrganization = true;
LinkPage.liteLayout = true;

export default LinkPage;
