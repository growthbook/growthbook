import type { AIChatMention } from "shared/ai-chat";
import Link from "@/ui/Link";
import { MentionPopover, SkillPopover, metricHref } from "./TokenPopovers";
import styles from "./MessageTokens.module.scss";

export type MessageTokenKind = "mention" | "command";

export interface MessageTokenPart {
  text: string;
  kind: MessageTokenKind | null;
}

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
          return (
            <MentionPopover key={i} mention={mention}>
              <Link href={metricHref(mention)} className={styles.token}>
                {part.text}
              </Link>
            </MentionPopover>
          );
        }

        return (
          <SkillPopover key={i} skill={part.text.slice(1)} text={part.text}>
            <span className={styles.token}>{part.text}</span>
          </SkillPopover>
        );
      })}
    </>
  );
}
