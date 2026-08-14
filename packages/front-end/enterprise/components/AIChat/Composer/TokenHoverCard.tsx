import type { AIChatMention, AIChatMentionType } from "shared/ai-chat";
import type { CSSProperties, ReactNode } from "react";
import {
  MentionTooltipContent,
  SkillTooltipContent,
  useSkillDescription,
} from "@/enterprise/components/AIChat/TokenTooltips";
import { METRIC_MENTION_NAME } from "./extensions/metricMention";
import { SKILL_COMMAND_NAME } from "./extensions/skillCommand";
import styles from "./TokenHoverCard.module.scss";

/** A token under the pointer, plus where to float its card. */
export interface HoveredToken {
  token:
    | { kind: "mention"; mention: AIChatMention }
    | { kind: "command"; skill: string; text: string };
  /** Offsets within the composer box, which is the positioning context. */
  left: number;
  bottom: number;
}

/**
 * Resolve a hovered element to the token it belongs to.
 *
 * The extensions render mentions and commands as plain spans carrying their
 * attributes as `data-*`, so reading the DOM is enough. A React node view would
 * give the same result but puts a component inside the contenteditable, which
 * changes how editing and selection behave for a much smaller payoff.
 */
export function readHoveredToken(
  target: EventTarget | null,
  box: HTMLElement | null,
): HoveredToken | null {
  if (!(target instanceof HTMLElement) || !box) return null;

  const el = target.closest<HTMLElement>("span[data-type]");
  const type = el?.dataset.type;
  const id = el?.dataset.id;
  const label = el?.dataset.label;
  if (!el || !type || !id || !label) return null;

  const rect = el.getBoundingClientRect();
  const boxRect = box.getBoundingClientRect();
  // Floated above the token: `bottom` is measured from the box's lower edge, so
  // the card grows upward without needing to know its own height.
  const position = {
    left: rect.left - boxRect.left,
    bottom: boxRect.height - (rect.top - boxRect.top) + 6,
  };

  if (type === METRIC_MENTION_NAME) {
    return {
      ...position,
      token: {
        kind: "mention",
        mention: {
          id,
          name: label,
          type: (el.dataset.metricType ?? "metric") as AIChatMentionType,
        },
      },
    };
  }
  if (type === SKILL_COMMAND_NAME) {
    return {
      ...position,
      token: { kind: "command", skill: id, text: `/${label}` },
    };
  }
  return null;
}

/**
 * The card shown when hovering a token inside the editor.
 *
 * Anchored to the composer box (which is already `position: relative` for the
 * suggestion popup) rather than through Tiptap's `BubbleMenu`: that plugin only
 * re-evaluates `shouldShow` on transactions, focus, blur, resize and scroll, so
 * a pointer moving over a token would never make it appear.
 *
 * Renders the same content as the chat log's tooltip, so a token explains
 * itself identically while being typed and after being sent.
 */
export default function TokenHoverCard({
  hovered,
}: {
  hovered: HoveredToken | null;
}) {
  if (!hovered) return null;

  const style = { left: hovered.left, bottom: hovered.bottom };

  return hovered.token.kind === "mention" ? (
    <Card style={style}>
      <MentionTooltipContent mention={hovered.token.mention} />
    </Card>
  ) : (
    <CommandCard
      style={style}
      skill={hovered.token.skill}
      text={hovered.token.text}
    />
  );
}

function Card({
  style,
  children,
}: {
  style: CSSProperties;
  children: ReactNode;
}) {
  return (
    // Purely informational, and the editor keeps the caret.
    <div className={styles.card} style={style} aria-hidden>
      {children}
    </div>
  );
}

/**
 * Its own component for two reasons: the skill index is only requested where
 * commands can appear (the PA composer has none, so this never mounts), and a
 * skill with no description renders nothing at all rather than an empty card.
 */
function CommandCard({
  style,
  skill,
  text,
}: {
  style: CSSProperties;
  skill: string;
  text: string;
}) {
  const description = useSkillDescription(skill);
  if (!description) return null;

  return (
    <Card style={style}>
      <SkillTooltipContent skill={skill} text={text} />
    </Card>
  );
}
