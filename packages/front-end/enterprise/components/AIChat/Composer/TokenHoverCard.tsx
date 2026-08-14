import type { AIChatMention, AIChatMentionType } from "shared/ai-chat";
import type { CSSProperties, RefObject } from "react";
import { PopoverContent } from "@/ui/Popover";
import {
  MentionPopoverContent,
  SkillPopoverContent,
  TOKEN_POPOVER_PADDING,
  useSkillDescription,
} from "@/enterprise/components/AIChat/TokenPopovers";
import { METRIC_MENTION_NAME } from "./extensions/metricMention";
import { SKILL_COMMAND_NAME } from "./extensions/skillCommand";
import styles from "./TokenHoverCard.module.scss";

/** A token under the pointer, plus where to float its card. */
export interface HoveredToken {
  token:
    | { kind: "mention"; mention: AIChatMention; stale: boolean }
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
  // the card grows upward without needing to know its own height. It sits flush
  // against the token — a visible gap is dead space the pointer would have to
  // cross to reach the link, and crossing it would close the card.
  const position = {
    left: rect.left - boxRect.left,
    bottom: boxRect.height - (rect.top - boxRect.top),
  };

  if (type === METRIC_MENTION_NAME) {
    return {
      ...position,
      token: {
        kind: "mention",
        // Set by the extension's decoration, so the card can say what the red
        // "!" on the chip means.
        stale: el.dataset.stale === "true",
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
 * The chat log gets this by wrapping its token in `@/ui/Popover`, but a token
 * here is a ProseMirror node inside a contenteditable, not an element a trigger
 * can wrap. So the composer positions the card itself — against the composer
 * box, which is already `position: relative` for the suggestion popup — and
 * renders it in `PopoverContent`, the same chrome `Popover` puts its content
 * in. Same surface, same content component, same card.
 *
 * Not Tiptap's `BubbleMenu`: that plugin only re-evaluates `shouldShow` on
 * transactions, focus, blur, resize and scroll, so a pointer moving over a
 * token would never make it appear.
 */
export default function TokenHoverCard({
  hovered,
  cardRef,
}: {
  hovered: HoveredToken | null;
  /** Lets the composer tell whether the pointer is over the card. */
  cardRef: RefObject<HTMLDivElement>;
}) {
  if (!hovered) return null;

  const style = { left: hovered.left, bottom: hovered.bottom };

  return hovered.token.kind === "mention" ? (
    <Card style={style} cardRef={cardRef}>
      <MentionPopoverContent
        mention={hovered.token.mention}
        stale={hovered.token.stale}
      />
    </Card>
  ) : (
    <CommandCard
      style={style}
      cardRef={cardRef}
      skill={hovered.token.skill}
      text={hovered.token.text}
    />
  );
}

function Card({
  style,
  cardRef,
  children,
}: {
  style: CSSProperties;
  cardRef: RefObject<HTMLDivElement>;
  children: React.ReactNode;
}) {
  return (
    // The positioning wrapper also carries the bridge that keeps the pointer
    // inside the card's hit area on its way down to the token.
    <div ref={cardRef} className={styles.anchor} style={style}>
      <PopoverContent>
        <div style={{ padding: TOKEN_POPOVER_PADDING }}>{children}</div>
      </PopoverContent>
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
  cardRef,
  skill,
  text,
}: {
  style: CSSProperties;
  cardRef: RefObject<HTMLDivElement>;
  skill: string;
  text: string;
}) {
  const description = useSkillDescription(skill);
  if (!description) return null;

  return (
    <Card style={style} cardRef={cardRef}>
      <SkillPopoverContent skill={skill} text={text} />
    </Card>
  );
}
