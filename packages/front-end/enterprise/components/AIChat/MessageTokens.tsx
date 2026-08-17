import type { AIChatMention } from "shared/ai-chat";
import Link from "@/ui/Link";
import { MentionPopover, SkillPopover, metricHref } from "./TokenPopovers";
import styles from "./MessageTokens.module.scss";

export type MessageTokenKind = "mention" | "command";

export interface MessageTokenPart {
  text: string;
  kind: MessageTokenKind | null;
}

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
 * A sent message with its @-mentions and `/` commands picked out, so each reads
 * as the distinct thing it is rather than as text the user happened to type.
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
          // The token is the link, rather than the card's "Open metric" being
          // the only way through. The card opens on hover, so an action living
          // only inside it is unreachable by keyboard or touch; a real link is
          // focusable, tappable and openable in a new tab, and the card stays
          // a description sitting on top of it.
          return (
            <MentionPopover key={i} mention={mention}>
              <Link href={metricHref(mention)} className={styles.token}>
                {part.text}
              </Link>
            </MentionPopover>
          );
        }

        // `text` is "/name"; the skill is keyed by the bare name. Not a link —
        // a skill has no page to open, so this stays a hover description.
        return (
          <SkillPopover key={i} skill={part.text.slice(1)} text={part.text}>
            <span className={styles.token}>{part.text}</span>
          </SkillPopover>
        );
      })}
    </>
  );
}
