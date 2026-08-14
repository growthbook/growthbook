import type { ReactElement } from "react";
import type { AIChatMention } from "shared/ai-chat";
import Link from "@/ui/Link";
import Tooltip from "@/ui/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useSkillCommandItems } from "@/enterprise/components/AIChat/Composer/useSkillCommandItems";
import { metricTypeLabel } from "@/enterprise/components/AIChat/Composer/useMetricMentionItems";
import styles from "./TokenTooltips.module.scss";

/**
 * Tooltips for composer tokens, wrapping whatever the caller renders as the
 * token itself. Shared so a mention explains itself identically while it is
 * still being typed in the composer and after it is sent to the log — the two
 * surfaces style the token differently but should never describe it
 * differently.
 *
 * Content is resolved just in time from data the client already holds, rather
 * than persisted alongside the token: descriptions and types change as metrics
 * and skills are edited, and an old message should not explain something as it
 * used to be.
 */

/** Branches on the mention's own type rather than guessing from the id shape. */
function metricHref({ type, id }: AIChatMention): string {
  if (type === "metricGroup") return `/metric-groups/${id}`;
  if (type === "factMetric") return `/fact-metrics/${id}`;
  return `/metric/${id}`;
}

/** The inner markup, so the editor's hover card can render it without a Tooltip. */
export function MentionTooltipContent({ mention }: { mention: AIChatMention }) {
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
    <span className={styles.tooltip}>
      <span className={styles.tooltipMeta}>
        <span className={styles.tooltipName}>
          {metricTypeLabel(mention.type, rawType)}
        </span>
        <Link href={metricHref(mention)} className={styles.tooltipLink}>
          Open metric
        </Link>
      </span>
      {description ? (
        <span>{description}</span>
      ) : (
        <span className={styles.tooltipEmpty}>No description</span>
      )}
    </span>
  );
}

export function MentionTooltip({
  mention,
  children,
}: {
  mention: AIChatMention;
  children: ReactElement;
}) {
  return (
    <Tooltip content={<MentionTooltipContent mention={mention} />}>
      {children}
    </Tooltip>
  );
}

/** Undefined when the skill isn't in the index — nothing to explain. */
export function useSkillDescription(skill: string): string | undefined {
  const skillItems = useSkillCommandItems();
  return skillItems.find((s) => s.id === skill)?.description;
}

export function SkillTooltipContent({
  skill,
  text,
}: {
  skill: string;
  text: string;
}) {
  const description = useSkillDescription(skill);
  if (!description) return null;

  return (
    <span className={styles.tooltip}>
      <span className={styles.tooltipMeta}>
        <span className={styles.tooltipName}>{text}</span>
      </span>
      <span>{description}</span>
    </span>
  );
}

export function SkillTooltip({
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

  return (
    <Tooltip
      enabled={!!description}
      content={<SkillTooltipContent skill={skill} text={text} />}
    >
      {children}
    </Tooltip>
  );
}
