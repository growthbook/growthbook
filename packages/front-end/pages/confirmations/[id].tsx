import { useRouter } from "next/router";
import { CSSProperties, ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Collapsible from "react-collapsible";
import {
  PiArrowSquareOut,
  PiCaretRightFill,
  PiShieldCheck,
} from "react-icons/pi";
import type { ApiConfirmation, ConfirmationLink } from "shared/validators";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { RequestLine } from "@/components/Agent/ConfirmActionCard";
import { describeActions } from "@/components/Settings/confirmRulesUtils";

type ConfirmationResponse = {
  confirmation: ApiConfirmation;
  links: ConfirmationLink[];
  request: {
    method: string;
    path: string;
    query: Record<string, unknown>;
    body: unknown;
  };
  requester: string;
  forEmail: string | null;
  canDecide: boolean;
};

const JSON_STYLE: CSSProperties = {
  margin: "var(--space-2) 0 0",
  padding: "var(--space-2)",
  maxHeight: "50vh",
  overflow: "auto",
  fontSize: 12,
  lineHeight: 1.4,
  borderRadius: "var(--radius-2)",
  background: "var(--gray-a3)",
  color: "var(--gray-12)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const NOUNS: Record<ConfirmationLink["type"], string> = {
  feature: "Feature Flag",
  experiment: "Experiment",
  savedGroup: "Saved Group",
  constant: "Constant",
  config: "Config",
};

// "Feature Flag affected:", "Experiments affected:", or for a mix "Resources affected:"
function affectedLabel(links: ConfirmationLink[]) {
  const noun =
    new Set(links.map((l) => l.type)).size === 1
      ? NOUNS[links[0].type]
      : undefined;
  return noun
    ? `${noun}${links.length > 1 ? "s" : ""} affected:`
    : "Resources affected:";
}

const errorMessage = (body: unknown) =>
  body && typeof body === "object" && "message" in body
    ? String(body.message)
    : "The request returned an error.";

// Same narrow layout as the OAuth consent page.
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <Box maxWidth="520px" mx="auto" my="9" px="4">
      {children}
    </Box>
  );
}

const OUTCOMES: Partial<
  Record<
    ApiConfirmation["status"],
    { status: "success" | "info" | "warning" | "error"; text: string }
  >
> = {
  completed: {
    status: "success",
    text: "Confirmed. You can close this window.",
  },
  rejected: {
    status: "info",
    text: "Rejected. Nothing was changed. You can close this window.",
  },
  expired: {
    status: "warning",
    text: "This request expired, so nothing was changed. Ask the agent to try again.",
  },
  running: { status: "info", text: "Confirmed. Running it now." },
};

export default function ConfirmationPage() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : "";
  const { apiCall } = useAuth();
  const { data, error, mutate } = useApi<ConfirmationResponse>(
    `/confirmations/${id}`,
    { shouldRun: () => !!id },
  );
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");

  const decide = async (decision: "confirm" | "reject") => {
    setSubmitting(true);
    setActionError("");
    try {
      await apiCall(`/confirmations/${id}/${decision}`, {
        method: "POST",
        body: JSON.stringify(decision === "reject" && note ? { note } : {}),
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong.");
    }
    await mutate();
    setSubmitting(false);
  };

  if (error) {
    return (
      <Wrapper>
        <Callout status="error">{error.message}</Callout>
      </Wrapper>
    );
  }
  if (!data) return <LoadingOverlay />;

  const { confirmation, links, request, requester, forEmail, canDecide } = data;
  const hasQuery = Object.keys(request.query).length > 0;
  const details =
    hasQuery || request.body !== undefined
      ? JSON.stringify(
          {
            ...(hasQuery ? { query: request.query } : {}),
            ...(request.body !== undefined ? { body: request.body } : {}),
          },
          null,
          2,
        )
      : null;
  // A confirmed request can still fail when it runs, e.g. a check it now fails.
  const failure =
    confirmation.status === "completed" &&
    (confirmation.response?.status ?? 0) >= 400
      ? errorMessage(confirmation.response?.body)
      : null;
  const outcome =
    failure !== null
      ? {
          status: "error" as const,
          text: `Confirmed, but it failed: ${failure} Nothing was changed.`,
        }
      : OUTCOMES[confirmation.status];
  const pending = confirmation.status === "pending";
  const minutesLeft = Math.max(
    0,
    Math.round(
      (new Date(confirmation.expiresAt).getTime() - Date.now()) / 60000,
    ),
  );

  return (
    <Wrapper>
      <Flex direction="column" align="center" mb="5">
        <Heading as="h1" size="xl" align="center" mb="1">
          {requester}
        </Heading>
        <Text as="div" size="lg" color="text-mid" align="center">
          wants to make a change that needs your confirmation.
        </Text>
      </Flex>

      {outcome ? (
        <Callout status={outcome.status} mb="4">
          {outcome.text}
          {confirmation.rejectionNote ? (
            <Box mt="2">Note: {confirmation.rejectionNote}</Box>
          ) : null}
        </Callout>
      ) : null}
      {pending && forEmail ? (
        <Callout status="error" mb="4">
          This request is for {forEmail}. Only the person it was made for can
          confirm it.
        </Callout>
      ) : null}
      {pending && !forEmail && !canDecide ? (
        <Callout status="error" mb="4">
          You don&apos;t have permission to make this change, so you can&apos;t
          confirm it.
        </Callout>
      ) : null}
      {actionError ? (
        <Callout status="error" mb="4">
          {actionError}
        </Callout>
      ) : null}

      <Frame>
        <Text as="div" size="sm" weight="medium" color="text-low" mb="1">
          The change
        </Text>
        <Heading as="h2" size="md" mb="3">
          {confirmation.summary}
        </Heading>
        <RequestLine method={request.method} path={request.path} />
        {details ? (
          <Collapsible
            trigger={
              <div className="link-purple font-weight-bold mt-1">
                <PiCaretRightFill className="chevron mr-1" />
                Request details
              </div>
            }
            transitionTime={100}
          >
            <pre style={JSON_STYLE}>{details}</pre>
          </Collapsible>
        ) : null}
        {links.length ? (
          <Flex align="center" gap="2" wrap="wrap" mt="4">
            <Text size="sm" weight="medium">
              {affectedLabel(links)}
            </Text>
            {links.map((link) => (
              <Link key={link.url} href={link.url} target="_blank">
                <Flex align="center" gap="1">
                  {link.label} <PiArrowSquareOut />
                </Flex>
              </Link>
            ))}
          </Flex>
        ) : null}
        <Flex gap="2" align="start" mt="4">
          {/* One text line tall, so the icon centers on the first line. */}
          <Flex
            align="center"
            flexShrink="0"
            style={{
              height: "var(--line-height-1)",
              color: "var(--violet-11)",
            }}
          >
            <PiShieldCheck size={14} />
          </Flex>
          <Text size="sm" color="text-mid">
            Requires confirmation for {describeActions(confirmation.actions)}.
          </Text>
        </Flex>
      </Frame>

      {pending && canDecide ? (
        <>
          <Field
            label="Note for the agent (optional)"
            textarea
            minRows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            helpText="Sent back to the agent if you reject."
          />
          <Flex gap="3" mt="4">
            <Button
              variant="soft"
              color="gray"
              size="lg"
              onClick={() => decide("reject")}
              disabled={submitting}
              style={{ flex: 1 }}
            >
              Reject
            </Button>
            <Button
              size="lg"
              onClick={() => decide("confirm")}
              loading={submitting}
              style={{ flex: 1 }}
            >
              Confirm
            </Button>
          </Flex>
          <Text as="div" size="sm" color="text-low" align="center" mt="3">
            Expires in {minutesLeft} minutes. Confirming doesn&apos;t count as a
            review approval.
          </Text>
        </>
      ) : null}
    </Wrapper>
  );
}

ConfirmationPage.liteLayout = true;
ConfirmationPage.mainClassName = "lite";
