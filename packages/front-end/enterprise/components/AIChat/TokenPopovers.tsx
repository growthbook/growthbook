import type { ReactElement } from "react";
import type { AIChatMention } from "shared/ai-chat";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useSkillCommandItems } from "@/enterprise/components/AIChat/Composer/useSkillCommandItems";
import { metricTypeLabel } from "@/enterprise/components/AIChat/Composer/useMetricMentionItems";
import styles from "./TokenPopovers.module.scss";

/**
 * The card behind a composer token, on both surfaces it can appear on: the
 * chat log, where the token is an ordinary element, and the Tiptap composer,
 * where it is a node inside a contenteditable and the editor positions the
 * card itself (see `TokenHoverCard`).
 *
 * A popover rather than a tooltip. It holds a link, and a tooltip closes the
 * moment the pointer leaves the token, so the link could never be clicked.
 * `@/ui/Popover`'s `openOnHover` keeps it open while the pointer is over the
 * card, which is what makes the action reachable.
 *
 * Content is resolved just in time from data the client already holds, rather
 * than persisted alongside the token: descriptions and types change as metrics
 * and skills are edited, and an old message should not explain something as it
 * used to be.
 */

/** Shared padding, so the editor's own card matches a real popover exactly. */
export const TOKEN_POPOVER_PADDING = "10px 12px";

/** Branches on the mention's own type rather than guessing from the id shape. */
function metricHref({ type, id }: AIChatMention): string {
  if (type === "metricGroup") return `/metric-groups/${id}`;
  if (type === "factMetric") return `/fact-metrics/${id}`;
  return `/metric/${id}`;
}

/** "Open metric" is wrong for a group, which is what the link actually opens. */
function openLabel(type: AIChatMention["type"]): string {
  return type === "metricGroup" ? "Open metric group" : "Open metric";
}

export function MentionPopoverContent({
  mention,
  stale = false,
}: {
  mention: AIChatMention;
  /** The metric is no longer offered — see the composer's stale decoration. */
  stale?: boolean;
}) {
  const { getMetricById, getFactMetricById, getMetricGroupById } =
    useDefinitions();

  // Look the metric up once for both the description and its statistical type;
  // only the kind ("factMetric") rides on the message, not the type ("Mean").
  let description: string | undefined;
  let rawType: string | undefined;
  if (mention.type === "metric") {
    const metric = getMetricById(mention.id);
    description = metric?.description;
    rawType = metric?.type;
  } else if (mention.type === "factMetric") {
    const metric = getFactMetricById(mention.id);
    description = metric?.description;
    rawType = metric?.metricType;
  } else {
    description = getMetricGroupById(mention.id)?.description;
  }

  return (
    <div className={styles.card}>
      {/* Name and type read as one unit, the same pairing the `@` menu uses. */}
      <div className={styles.header}>
        <span className={styles.name}>{mention.name}</span>
        <Badge
          size="xs"
          variant="soft"
          label={metricTypeLabel(mention.type, rawType)}
        />
      </div>
      {stale && (
        <div className={styles.warning}>
          Not available in the selected Data Source
        </div>
      )}
      {description ? (
        <div className={styles.description}>{description}</div>
      ) : (
        <div className={styles.empty}>No description</div>
      )}
      <Link href={metricHref(mention)} className={styles.action}>
        {openLabel(mention.type)}
      </Link>
    </div>
  );
}

export function SkillPopoverContent({
  skill,
  text,
}: {
  skill: string;
  text: string;
}) {
  const description = useSkillDescription(skill);
  if (!description) return null;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.command}>{text}</span>
      </div>
      <div className={styles.description}>{description}</div>
    </div>
  );
}

/** Undefined when the skill isn't in the index — nothing to explain. */
export function useSkillDescription(skill: string): string | undefined {
  const skillItems = useSkillCommandItems();
  return skillItems.find((s) => s.id === skill)?.description;
}

/**
 * Wraps a token in the chat log. The composer can't use this — its tokens live
 * inside a contenteditable, so it positions the same content itself.
 */
export function MentionPopover({
  mention,
  children,
}: {
  mention: AIChatMention;
  children: ReactElement;
}) {
  return (
    <Popover
      openOnHover
      showArrow={false}
      side="top"
      align="start"
      contentStyle={{ padding: TOKEN_POPOVER_PADDING }}
      trigger={children}
      content={<MentionPopoverContent mention={mention} />}
    />
  );
}

export function SkillPopover({
  skill,
  text,
  children,
}: {
  skill: string;
  /** The command as written, e.g. "/flag-create". */
  text: string;
  children: ReactElement;
}) {
  const description = useSkillDescription(skill);
  // Nothing to say — leave the token as plain markup rather than opening an
  // empty card on hover.
  if (!description) return children;

  return (
    <Popover
      openOnHover
      showArrow={false}
      side="top"
      align="start"
      contentStyle={{ padding: TOKEN_POPOVER_PADDING }}
      trigger={children}
      content={<SkillPopoverContent skill={skill} text={text} />}
    />
  );
}
