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

export interface HoveredToken {
  token:
    | { kind: "mention"; mention: AIChatMention; stale: boolean }
    | { kind: "command"; skill: string; text: string };
  left: number;
  bottom: number;
}

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
  const position = {
    left: rect.left - boxRect.left,
    bottom: boxRect.height - (rect.top - boxRect.top),
  };

  if (type === METRIC_MENTION_NAME) {
    return {
      ...position,
      token: {
        kind: "mention",
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

export default function TokenHoverCard({
  hovered,
  cardRef,
}: {
  hovered: HoveredToken | null;
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
    <div ref={cardRef} className={styles.anchor} style={style}>
      <PopoverContent>
        <div style={{ padding: TOKEN_POPOVER_PADDING }}>{children}</div>
      </PopoverContent>
    </div>
  );
}

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
