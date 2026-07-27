import { ReactNode, useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";

// Preview of the "text only" notification: renders the real message the app
// would post (fetched from the event-webhook previews) in a Slack-message mockup.

type SlackBlock = {
  type: string;
  text?: { text?: string };
  elements?: { text?: string }[];
};
type PreviewMessage = { text: string; blocks: SlackBlock[] };
type PreviewsResult = {
  ok: boolean;
  previews?: { eventName: string; slackMessage: PreviewMessage }[];
  error?: string;
};

// Minimal Slack mrkdwn → React: <url|label> / <url> links, *bold*, _italic_,
// `code`. Everything else renders as plain text.
function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*([^*]+)\*|_([^_]+)_|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) nodes.push(<strong key={`${keyBase}-b${i}`}>{m[1]}</strong>);
    else if (m[2]) nodes.push(<em key={`${keyBase}-i${i}`}>{m[2]}</em>);
    else if (m[3])
      nodes.push(
        <code
          key={`${keyBase}-c${i}`}
          style={{ fontSize: "0.9em", opacity: 0.9 }}
        >
          {m[3]}
        </code>,
      );
    last = re.lastIndex;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderLine(line: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /<([^|>]+)\|([^>]+)>|<([^>]+)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last)
      nodes.push(...renderInline(line.slice(last, m.index), `${keyBase}-${i}`));
    const url = m[1] ?? m[3] ?? "";
    const label = m[2] ?? m[3] ?? url;
    nodes.push(
      <a
        key={`${keyBase}-l${i}`}
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{ color: "var(--accent-11)" }}
      >
        {label}
      </a>,
    );
    last = re.lastIndex;
    i++;
  }
  if (last < line.length)
    nodes.push(...renderInline(line.slice(last), `${keyBase}-${i}`));
  return nodes;
}

function renderMrkdwn(md: string): ReactNode {
  return md.split("\n").map((line, i) =>
    line.trim() === "" ? (
      <Box key={i} style={{ height: 6 }} />
    ) : (
      <div key={i} style={{ lineHeight: 1.5 }}>
        {renderLine(line, `${i}`)}
      </div>
    ),
  );
}

function renderMessageBody(msg: PreviewMessage): ReactNode {
  const parts: ReactNode[] = [];
  msg.blocks.forEach((b, i) => {
    if (b.type === "header" && b.text?.text) {
      parts.push(
        <Text key={`h${i}`} weight="medium" as="div">
          {b.text.text}
        </Text>,
      );
    } else if (b.type === "section" && b.text?.text) {
      parts.push(<div key={`s${i}`}>{renderMrkdwn(b.text.text)}</div>);
    } else if (b.type === "context") {
      const t = (b.elements || [])
        .map((e) => e.text)
        .filter(Boolean)
        .join(" · ");
      if (t)
        parts.push(
          <Text key={`c${i}`} size="small" color="text-mid" as="div">
            {renderMrkdwn(t)}
          </Text>,
        );
    }
  });
  if (!parts.length)
    parts.push(<div key="fallback">{renderMrkdwn(msg.text)}</div>);
  return (
    <Flex direction="column" gap="2">
      {parts}
    </Flex>
  );
}

export default function SlackMessagePreview({
  eventName = "experiment.info.significance",
  botName = "GrowthBook",
}: {
  eventName?: string;
  botName?: string;
}) {
  const { apiCall } = useAuth();
  const [message, setMessage] = useState<PreviewMessage | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMessage(null);
    setErr(null);
    (async () => {
      try {
        const res = await apiCall<PreviewsResult>(
          "/admin/slack-test/event-webhook/previews",
        );
        if (cancelled) return;
        if (!res.ok || !res.previews?.length) {
          setErr(res.error || "Couldn't build a preview.");
          return;
        }
        const chosen =
          res.previews.find((p) => p.eventName === eventName) ||
          res.previews[0];
        setMessage(chosen.slackMessage);
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Couldn't build a preview.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiCall, eventName]);

  if (err) return <HelperText status="error">{err}</HelperText>;
  if (!message)
    return (
      <Text as="p" color="text-mid" size="small" mb="0">
        Building preview…
      </Text>
    );

  return (
    <Box
      style={{
        maxWidth: 520,
        border: "1px solid var(--gray-a5)",
        borderRadius: 8,
        padding: "12px 14px",
        background: "var(--color-panel)",
      }}
    >
      <Flex gap="3" align="start">
        <Box
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
            borderRadius: 7,
            background: "var(--accent-9)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 15,
          }}
        >
          G
        </Box>
        <Box style={{ minWidth: 0 }}>
          <Flex gap="2" align="center" mb="1">
            <Text weight="medium" as="span">
              {botName}
            </Text>
            <span
              style={{
                background: "var(--gray-a3)",
                color: "var(--color-text-mid)",
                borderRadius: 3,
                padding: "0 4px",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              App
            </span>
            <Text size="small" color="text-mid" as="span">
              now
            </Text>
          </Flex>
          {renderMessageBody(message)}
        </Box>
      </Flex>
    </Box>
  );
}
