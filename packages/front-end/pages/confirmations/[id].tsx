import { useRouter } from "next/router";
import { ReactNode, useState } from "react";
import escapeRegExp from "lodash/escapeRegExp";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut, PiTimer } from "react-icons/pi";
import type {
  ApiConfirmation,
  ConfirmAction,
  ConfirmationLink,
  ConfirmationNotice,
} from "shared/validators";
import { capitalizeFirstCharacter } from "shared/util";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import HelperText, { type Status } from "@/ui/HelperText";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { RequestLine } from "@/components/Agent/ConfirmActionCard";
import RequestDetails from "@/components/Confirmations/RequestDetails";
import { verbOf } from "@/components/Settings/confirmRulesUtils";
import {
  isPolicySkip,
  skipSeverity,
  skipsOf,
  type Skip,
} from "@/components/Confirmations/skips";

type ConfirmationResponse = {
  confirmation: ApiConfirmation;
  links: ConfirmationLink[];
  notices: ConfirmationNotice[];
  lastAttemptAt: string | null;
  request: {
    method: string;
    path: string;
    query: Record<string, unknown>;
    body: unknown;
  };
  overrides: ConfirmAction[];
  sentOverrides: ConfirmAction[];
  requester: {
    personal: boolean;
    person: string | null;
    assumedRole: boolean;
    keyDescription: string | null;
  };
  canDecide: boolean;
};

// "production", "production and staging", "dev, staging and production"
const listJoin = (items: string[]) =>
  items.length > 1
    ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
    : items[0];

// What the change acts on, named by its links, stands out in its summary:
// the first whole-word mention of each.
function withTargets(summary: string, links: ConfirmationLink[]): ReactNode {
  const labels = [...new Set(links.map((link) => link.label))]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!labels.length) return summary;
  const bolded = new Set<string>();
  return summary
    .split(
      new RegExp(
        `(?<![\\w-])(${labels.map(escapeRegExp).join("|")})(?![\\w-])`,
      ),
    )
    .map((part, i) => {
      if (!labels.includes(part) || bolded.has(part)) return part;
      bolded.add(part);
      return <strong key={i}>{part}</strong>;
    });
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <Text as="div" size="md" weight="semibold" color="text-mid" mb="2">
      {children}
    </Text>
  );
}

function bypassReason(
  via: ConfirmationNotice["via"],
  requester: ConfirmationResponse["requester"],
) {
  switch (via) {
    case "bypassApprovalPermission":
      return `Confirming skips this check because ${
        requester.personal
          ? "the token's owner"
          : requester.assumedRole
            ? "the member this key acts as"
            : "this key"
      } can bypass approvals.`;
    case "restApiBypassesReviews":
      return "Confirming skips this check because your organization lets REST API requests bypass it.";
    case "revertsBypassApproval":
      return "Confirming reverts without approval because your organization lets reverts skip approval.";
    case "ignoreWarnings":
      return "Confirming ignores this warning.";
    case "skipSchemaValidation":
      return "Confirming skips schema validation.";
    case "skipHooks":
      return "Confirming skips the custom validation hooks.";
    case "skipChecklist":
      return "Confirming skips the experiment's incomplete checklist items.";
    case null:
      return null;
  }
}

function SkipCallout({
  skip,
  status,
  requester,
}: {
  skip: Skip;
  status: Status;
  requester: ConfirmationResponse["requester"];
}) {
  const messages = skip.notices.flatMap((notice) => notice.messages);
  const reasons = [
    ...new Set(
      [...skip.notices.map((notice) => notice.via), skip.policy].map((via) =>
        bypassReason(via, requester),
      ),
    ),
  ].filter(Boolean);
  const lines = (items: string[]) =>
    items.map((message, i) => (
      <Box key={i} mt={i ? "1" : undefined} style={{ whiteSpace: "pre-wrap" }}>
        <Text size="inherit">{message}</Text>
      </Box>
    ));
  return (
    <Callout status={status} size="sm">
      <Text as="div" size="inherit" weight="semibold">
        {skip.action
          ? capitalizeFirstCharacter(verbOf(skip.action))
          : messages[0]}
      </Text>
      {skip.action ? (
        messages.length ? (
          <Box
            mt="2"
            pl="3"
            style={{ borderLeft: "2px solid var(--accent-a6)" }}
          >
            <Text as="div" size="sm" weight="medium" mb="1">
              Server message
            </Text>
            {lines(messages)}
          </Box>
        ) : null
      ) : messages.length > 1 ? (
        <Box mt="1">{lines(messages.slice(1))}</Box>
      ) : null}
      {reasons.map((reason) => (
        <Box key={reason} mt="2">
          <Text size="sm">{reason}</Text>
        </Box>
      ))}
    </Callout>
  );
}

const errorMessage = (body: unknown) =>
  body && typeof body === "object" && "message" in body
    ? String(body.message)
    : "The request returned an error.";

// Same narrow layout as the OAuth consent page.
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <Box maxWidth="520px" mx="auto" mt="6" mb="9" px="4">
      {children}
    </Box>
  );
}

const OUTCOMES: Partial<
  Record<
    ApiConfirmation["status"],
    { status: Status; text: string; icon?: ReactNode }
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
    icon: <PiTimer />,
  },
  running: { status: "info", text: "Confirmed. Running it now." },
};

export default function ConfirmationPage() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : "";
  const { apiCall } = useAuth();
  const { data, error, mutate } = useApi<ConfirmationResponse>(
    `/confirmations/${id}`,
    {
      shouldRun: () => !!id,
      // Stays current while open, until someone decides or it expires.
      refreshInterval: (latest) =>
        latest && ["pending", "running"].includes(latest.confirmation.status)
          ? 5000
          : 0,
    },
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
        body: JSON.stringify(note ? { note } : {}),
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong.");
    }
    await mutate();
    setSubmitting(false);
  };

  // A failed refresh keeps the page it already loaded.
  if (error && !data) {
    return (
      <Wrapper>
        <Callout status="error">{error.message}</Callout>
      </Wrapper>
    );
  }
  if (!data) return <LoadingOverlay />;

  const {
    confirmation,
    links,
    notices,
    lastAttemptAt,
    request,
    overrides,
    sentOverrides,
    requester,
    canDecide,
  } = data;
  const hasQuery = Object.keys(request.query).length > 0;
  const details =
    hasQuery || request.body !== undefined
      ? // Undefined keys drop out
        JSON.stringify(
          { query: hasQuery ? request.query : undefined, body: request.body },
          null,
          2,
        )
      : null;
  const environments = [
    ...new Set(confirmation.actions.flatMap((a) => a.environments)),
  ];
  const skips = skipsOf(overrides, sentOverrides, notices);
  const checks = skips.filter((skip) => !isPolicySkip(skip));
  const policies = skips.filter(isPolicySkip);
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
          text: `Confirmed, but it failed: ${failure.replace(/[.!?]?$/, ".")} You can close this window.`,
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
        {/* The key leads: an agent driving it is why this is held. */}
        <Heading as="h1" size="xl" align="center" mb="0">
          {requester.keyDescription ??
            (requester.personal ? "A Personal Access Token" : "An API Key")}
        </Heading>
        <Text as="div" size="md" color="text-low" align="center" mb="2">
          {requester.personal ? (
            <>
              Personal access token for{" "}
              <Text size="inherit" weight="semibold" color="text-mid">
                {requester.person ?? "a former member"}
              </Text>
            </>
          ) : requester.person ? (
            <>
              API key {requester.assumedRole ? "acting as" : "for"}{" "}
              <Text size="inherit" weight="semibold" color="text-mid">
                {requester.person}
              </Text>
            </>
          ) : (
            "API key"
          )}
        </Text>
        <Text as="div" size="lg" color="text-high" align="center">
          wants to make a change that needs your confirmation.
        </Text>
      </Flex>

      {outcome ? (
        <Callout status={outcome.status} icon={outcome.icon} mb="4">
          {outcome.text}
          {confirmation.note ? (
            <Box mt="2">Note: {confirmation.note}</Box>
          ) : null}
        </Callout>
      ) : null}
      {pending && !canDecide ? (
        <Callout status="warning" mb="4">
          This request is for {requester.person ?? "someone else"}, so only they
          can confirm it.
        </Callout>
      ) : null}
      {actionError ? (
        <Callout status="error" mb="4">
          {actionError}
        </Callout>
      ) : null}

      <Frame>
        <SectionHeader>The change</SectionHeader>
        <Heading as="h2" size="md" weight="medium" mb="0">
          {withTargets(confirmation.summary, links)}
        </Heading>
        {environments.length ? (
          <Text as="div" color="text-mid" mt="1">
            In {listJoin(environments)}
          </Text>
        ) : null}
        <Box mt="5">
          <SectionHeader>Request</SectionHeader>
          <RequestLine method={request.method} path={request.path} />
          {details ? <RequestDetails json={details} /> : null}
        </Box>
        {checks.length ? (
          <Box mt="5">
            <SectionHeader>Checks this skips</SectionHeader>
            {lastAttemptAt ? (
              <Text as="div" size="sm" color="text-low" mt="-1" mb="2">
                From the agent&apos;s last try at this request.
              </Text>
            ) : null}
            <Flex direction="column" gap="2">
              {checks.map((skip, i) => (
                <SkipCallout
                  key={i}
                  skip={skip}
                  status={skipSeverity(skip)}
                  requester={requester}
                />
              ))}
            </Flex>
          </Box>
        ) : null}
        {policies.length ? (
          <Box mt="5">
            <SectionHeader>Policies this bypasses</SectionHeader>
            <Flex direction="column" gap="2">
              {policies.map((skip, i) => (
                <SkipCallout
                  key={i}
                  skip={skip}
                  status="info"
                  requester={requester}
                />
              ))}
            </Flex>
          </Box>
        ) : null}
        {links.length ? (
          <Box mt="5">
            <SectionHeader>Affected by this change</SectionHeader>
            <Flex direction="column" align="start" gap="1">
              {links.map((link) => (
                <Link key={link.url} href={link.url} external>
                  <Flex align="center" gap="1">
                    {link.label} <PiArrowSquareOut />
                  </Flex>
                </Link>
              ))}
            </Flex>
          </Box>
        ) : null}
      </Frame>

      {pending && canDecide ? (
        <>
          <Field
            label="Note for the agent (optional)"
            textarea
            minRows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            helpText="Sent back to the agent with your decision. It can't change the request you're confirming."
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
              disabled={submitting}
              style={{ flex: 1 }}
            >
              Confirm
            </Button>
          </Flex>
          <Flex justify="center" mt="3">
            <HelperText status="info" size="sm" icon={<PiTimer />}>
              Expires in{" "}
              {minutesLeft === 0
                ? "less than a minute"
                : `${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}`}
            </HelperText>
          </Flex>
          <Text as="div" size="sm" color="text-low" align="center" mt="1">
            Confirming doesn&apos;t count as a review approval.
          </Text>
        </>
      ) : null}
    </Wrapper>
  );
}

ConfirmationPage.liteLayout = true;
ConfirmationPage.mainClassName = "lite";
