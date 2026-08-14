import type { AIChatMention } from "shared/ai-chat";
import styles from "./MessageTokens.module.scss";

export type MessageTokenKind = "mention" | "command";

export interface MessageTokenPart {
  text: string;
  kind: MessageTokenKind | null;
}

/**
 * Split a sent message into plain runs and the composer tokens inside it.
 *
 * Matches against the message's own `mentions` / `skill` rather than an
 * `@\w+` / `/\w+` pattern: metric names contain spaces ("@Any Purchases"),
 * which no word pattern can bound, and matching known values means an email
 * address, a URL path, or a stray "@" in prose is never mistaken for a token.
 */
export function splitMessageTokens(
  text: string,
  mentions: AIChatMention[] | undefined,
  skill: string | undefined,
): MessageTokenPart[] {
  const tokens: { value: string; kind: MessageTokenKind }[] = [];
  for (const name of new Set((mentions ?? []).map((m) => m.name))) {
    if (name) tokens.push({ value: `@${name}`, kind: "mention" });
  }
  if (skill) tokens.push({ value: `/${skill}`, kind: "command" });

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
 * A sent message with its @-mentions and `/` command picked out, so each reads
 * as the distinct thing it is rather than as text the user happened to type.
 */
export default function MessageTokens({
  text,
  mentions,
  skill,
}: {
  text: string;
  mentions?: AIChatMention[];
  skill?: string;
}) {
  const parts = splitMessageTokens(text, mentions, skill);

  return (
    <>
      {parts.map((part, i) =>
        part.kind ? (
          <span key={i} className={styles.token}>
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
