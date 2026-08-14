import type { AIChatMention } from "shared/ai-chat";
import Tooltip from "@/ui/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useSkillCommandItems } from "@/enterprise/components/AIChat/Composer/useSkillCommandItems";
import styles from "./MessageTokens.module.scss";

export type MessageTokenKind = "mention" | "command";

export interface MessageTokenPart {
  text: string;
  kind: MessageTokenKind | null;
}

const METRIC_TYPE_LABELS: Record<AIChatMention["type"], string> = {
  metric: "Metric",
  factMetric: "Fact Metric",
  metricGroup: "Metric Group",
};

/**
 * Split a sent message into plain runs and the composer tokens inside it.
 *
 * Matches against the message's own `mentions` / `skills` rather than an
 * `@\w+` / `/\w+` pattern: metric names contain spaces ("@Any Purchases"),
 * which no word pattern can bound, and matching known values means an email
 * address, a URL path, or a stray "@" in prose is never mistaken for a token.
 */
export function splitMessageTokens(
  text: string,
  mentions: AIChatMention[] | undefined,
  skills: string[] | undefined,
): MessageTokenPart[] {
  const tokens: { value: string; kind: MessageTokenKind }[] = [];
  for (const name of new Set((mentions ?? []).map((m) => m.name))) {
    if (name) tokens.push({ value: `@${name}`, kind: "mention" });
  }
  for (const skill of new Set(skills ?? [])) {
    if (skill) tokens.push({ value: `/${skill}`, kind: "command" });
  }

  // Longest first, so "@Total Revenue" wins over a "@Total" that also exists.
  tokens.sort((a, b) => b.value.length - a.value.length);

  if (!tokens.length) return [{ text, kind: null }];

  const parts: MessageTokenPart[] = [];
  let cursor = 0;
  let plainStart = 0;

  while (cursor < text.length) {
    const match = tokens.find((t) => text.startsWith(t.value, cursor));
    if (!match) {
      cursor++;
      continue;
    }
    if (cursor > plainStart) {
      parts.push({ text: text.slice(plainStart, cursor), kind: null });
    }
    parts.push({ text: match.value, kind: match.kind });
    cursor += match.value.length;
    plainStart = cursor;
  }

  if (plainStart < text.length) {
    parts.push({ text: text.slice(plainStart), kind: null });
  }
  return parts;
}

/**
 * A mention, with its type and current description on hover.
 *
 * The description is read from the definitions the app already holds rather
 * than persisted on the message: it is content that changes as metrics are
 * edited, so looking it up keeps an old message from describing a metric as it
 * used to be. A metric deleted since simply loses its description — the type
 * tag still comes from the message itself.
 */
function MentionToken({
  text,
  mention,
}: {
  text: string;
  mention: AIChatMention;
}) {
  const { getMetricById, getFactMetricById, getMetricGroupById } =
    useDefinitions();

  const description =
    mention.type === "metric"
      ? getMetricById(mention.id)?.description
      : mention.type === "factMetric"
        ? getFactMetricById(mention.id)?.description
        : getMetricGroupById(mention.id)?.description;

  return (
    <Tooltip
      content={
        <span className={styles.tooltip}>
          <span className={styles.tooltipTag}>
            {METRIC_TYPE_LABELS[mention.type]}
          </span>
          {description && <span>{description}</span>}
        </span>
      }
    >
      <span className={styles.token}>{text}</span>
    </Tooltip>
  );
}

/**
 * A `/` command, with the skill's current description on hover.
 *
 * Its own component so the skill index is only requested where commands
 * actually appear — the PA chat has no skills, and never mounts this.
 */
function CommandToken({ text, skill }: { text: string; skill: string }) {
  const skillItems = useSkillCommandItems();
  const description = skillItems.find((s) => s.id === skill)?.description;

  return (
    <Tooltip
      enabled={!!description}
      content={
        <span className={styles.tooltip}>
          <span className={styles.tooltipName}>{text}</span>
          <span>{description}</span>
        </span>
      }
    >
      <span className={styles.token}>{text}</span>
    </Tooltip>
  );
}

/**
 * A sent message with its @-mentions and `/` commands picked out, so each reads
 * as the distinct thing it is rather than as text the user happened to type.
 *
 * Tooltip content is resolved just in time by each token from data the client
 * already has, so nothing between here and the composer has to carry it.
 */
export default function MessageTokens({
  text,
  mentions,
  skills,
}: {
  text: string;
  mentions?: AIChatMention[];
  skills?: string[];
}) {
  const parts = splitMessageTokens(text, mentions, skills);
  // Tokens are keyed by name (duplicates collapse into one), so resolving the
  // rendered token back to its mention by the same key stays consistent.
  const mentionByToken = new Map<string, AIChatMention>(
    (mentions ?? []).map((m) => [`@${m.name}`, m]),
  );

  return (
    <>
      {parts.map((part, i) => {
        if (!part.kind) return part.text;

        if (part.kind === "mention") {
          const mention = mentionByToken.get(part.text);
          if (!mention) return part.text;
          return <MentionToken key={i} text={part.text} mention={mention} />;
        }

        // `text` is "/name"; the skill is keyed by the bare name.
        return (
          <CommandToken key={i} text={part.text} skill={part.text.slice(1)} />
        );
      })}
    </>
  );
}
