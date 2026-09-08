import type { ReactElement } from "react";
import { ScrollArea } from "@radix-ui/themes";
import type { AIChatMention } from "shared/ai-chat";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import Markdown from "@/components/Markdown/Markdown";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useSkillCommandItems } from "@/enterprise/components/AIChat/Composer/useSkillCommandItems";
import { metricTypeLabel } from "@/enterprise/components/AIChat/Composer/useMetricMentionItems";
import styles from "./TokenPopovers.module.scss";

export const TOKEN_POPOVER_PADDING = "10px 0";

export function metricHref({ type, id }: AIChatMention): string {
  if (type === "metricGroup") return `/metric-groups/${id}`;
  if (type === "factMetric") return `/fact-metrics/${id}`;
  return `/metric/${id}`;
}

function openLabel(type: AIChatMention["type"]): string {
  return type === "metricGroup" ? "Open metric group" : "Open metric";
}

export function MentionPopoverContent({
  mention,
  stale = false,
}: {
  mention: AIChatMention;
  stale?: boolean;
}) {
  const { getMetricById, getFactMetricById, getMetricGroupById } =
    useDefinitions();

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
    <div className={cardClass(description)}>
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
        <Description>{description}</Description>
      ) : (
        <div className={styles.empty}>No description</div>
      )}
      <Link href={metricHref(mention)} className={styles.action}>
        {openLabel(mention.type)}
      </Link>
    </div>
  );
}

function cardClass(description?: string): string {
  return description ? `${styles.card} ${styles.cardWide}` : styles.card;
}

function Description({ children }: { children: string }) {
  return (
    <ScrollArea type="auto" scrollbars="vertical" className={styles.scroll}>
      <Markdown className={styles.description}>{children}</Markdown>
    </ScrollArea>
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
    <div className={cardClass(description)}>
      <div className={styles.header}>
        <span className={styles.command}>{text}</span>
      </div>
      <Description>{description}</Description>
    </div>
  );
}

export function useSkillDescription(skill: string): string | undefined {
  const skillItems = useSkillCommandItems();
  return skillItems.find((s) => s.id === skill)?.description;
}

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
  text: string;
  children: ReactElement;
}) {
  const description = useSkillDescription(skill);
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
