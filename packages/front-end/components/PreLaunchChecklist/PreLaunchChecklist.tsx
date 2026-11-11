import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { PiArrowSquareOut, PiCheckBold } from "react-icons/pi";
import clsx from "clsx";
import { Flex, Separator } from "@radix-ui/themes";
import NextLink from "next/link";
import Link from "@/ui/Link";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "@/components/LoadingSpinner";
import useExperimentEditing from "@/components/Experiment/TabbedPage/useExperimentEditing";
import Callout from "@/ui/Callout";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import styles from "./PreLaunchChecklist.module.scss";
import {
  useLaunchChecklistData,
  usePreLaunchChecklist,
} from "./PreLaunchChecklistProvider";
import {
  ChecklistAction,
  CheckListItem,
  getChecklistItems,
} from "./PreLaunchChecklistItems";
import {
  CHECKLIST_TIERS,
  ChecklistSummary,
  ChecklistTier,
  getChecklistTier,
  summarizeChecklist,
} from "./checklistSummary";
import { useManualChecklistToggle } from "./useManualChecklistToggle";

export type ChecklistReadyStatus = {
  hasHardBlockers: boolean;
  hasSoftBlockers: boolean;
  loading: boolean;
};

type ChecklistSize = "sm" | "md";

const TIER_TITLES: Record<ChecklistTier, string> = {
  blocking: "Must resolve",
  recommended: "Recommended",
  optional: "Optional",
};

const loadErrorNotice = (
  <HelperText status="warning" size="sm">
    Couldn&apos;t load the custom checklist. Built-in items are shown.
  </HelperText>
);

// Stretched over its row, so the whole row takes the action.
function ChecklistRowAction({
  action,
  children,
}: {
  action: ChecklistAction;
  children: ReactNode;
}) {
  const attrs = { className: styles.rowAction, "data-checklist-action": "" };
  if ("onClick" in action) {
    return (
      <button type="button" {...attrs} onClick={action.onClick}>
        {children}
      </button>
    );
  }
  if (!action.external) {
    return (
      <NextLink href={action.href} {...attrs}>
        {children}
      </NextLink>
    );
  }
  return (
    <a href={action.href} target="_blank" rel="noopener noreferrer" {...attrs}>
      {children}
      <PiArrowSquareOut className={styles.externalIcon} />
    </a>
  );
}

function ChecklistRow({
  item,
  size,
  onToggleManual,
  onFaded = null,
  readOnly = false,
}: {
  item: CheckListItem;
  size: ChecklistSize;
  onToggleManual: ((manualKey: string, checked: boolean) => void) | null;
  // Fades the row out, then calls this.
  onFaded?: (() => void) | null;
  readOnly?: boolean;
}) {
  const complete = item.status === "complete";
  const manualKey = item.manualKey;
  const toggle =
    manualKey && onToggleManual && !readOnly
      ? (checked: boolean) => onToggleManual(manualKey, checked)
      : null;
  const action =
    !readOnly && (!complete || item.warning) ? item.action : undefined;
  return (
    <div
      className={clsx(styles.row, onFaded && styles.fading)}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) onFaded?.();
      }}
    >
      <Checkbox
        size={size}
        labelSize={size}
        weight="regular"
        value={complete}
        setValue={(checked) => toggle?.(checked)}
        readOnly={!toggle}
        checkboxTooltip={
          item.type === "auto" && !complete && !readOnly
            ? "Checked automatically when this task is finished."
            : undefined
        }
        containerClassName={clsx({
          [styles.interactive]: !!toggle || !!action,
          [styles.actionable]: !!action,
          [styles.readonly]: !toggle,
          [styles.readonlyIncomplete]: !toggle && !complete,
        })}
        label={
          action ? (
            <ChecklistRowAction action={action}>
              {item.display}
            </ChecklistRowAction>
          ) : (
            item.display
          )
        }
        description={complete ? undefined : item.description}
        error={item.warning}
        errorLevel="warning"
      />
    </div>
  );
}

type FadingItem = { key: string; tier: ChecklistTier; index: number };

// Items just ticked off stay in their sections, ticked, until they've faded
// out of them. They're under Completed from the start.
function useFadingCompletions(
  lists: Record<ChecklistTier, CheckListItem[]>,
  complete: CheckListItem[],
) {
  const signature = CHECKLIST_TIERS.map((tier) =>
    lists[tier].map((item) => item.key).join("\n"),
  ).join("\n\n");
  const [prev, setPrev] = useState({ signature, lists });
  const [fading, setFading] = useState<FadingItem[]>([]);
  if (signature !== prev.signature) {
    const listed = new Set(
      CHECKLIST_TIERS.flatMap((tier) => lists[tier].map((item) => item.key)),
    );
    const done = new Set(complete.map((item) => item.key));
    const justDone = (key: string) => done.has(key) && !listed.has(key);
    setPrev({ signature, lists });
    setFading([
      ...fading.filter((item) => justDone(item.key)),
      ...CHECKLIST_TIERS.flatMap((tier) =>
        prev.lists[tier].flatMap((item, index) =>
          justDone(item.key) ? [{ key: item.key, tier, index }] : [],
        ),
      ),
    ]);
  }

  const doneByKey = new Map(complete.map((item) => [item.key, item]));
  const withFading = (tier: ChecklistTier) => {
    const items = [...lists[tier]];
    fading
      .filter((item) => item.tier === tier)
      .sort((a, b) => a.index - b.index)
      .forEach(({ key, index }) => {
        const item = doneByKey.get(key);
        if (item) items.splice(Math.min(index, items.length), 0, item);
      });
    return items;
  };
  const isFading = (key: string) => fading.some((item) => item.key === key);
  const faded = (key: string) =>
    setFading((items) => items.filter((item) => item.key !== key));
  return { withFading, isFading, faded };
}

export function ReadOnlyChecklistRows({ items }: { items: CheckListItem[] }) {
  return (
    <Flex direction="column" gap="2">
      {items.map((item) => (
        <ChecklistRow
          key={item.key}
          item={item}
          size="sm"
          onToggleManual={null}
          readOnly
        />
      ))}
    </Flex>
  );
}

function CompletedItems({
  items,
  size,
  onToggleManual,
}: {
  items: CheckListItem[];
  size: ChecklistSize;
  onToggleManual: ((manualKey: string, checked: boolean) => void) | null;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <CollapseTrigger open={expanded} onOpenChange={setExpanded}>
        <Text size="sm" weight="semibold" color="text-high">
          Completed ({items.length})
        </Text>
      </CollapseTrigger>
      <Collapse open={expanded}>
        <Flex direction="column" gap="2" pt="3">
          {items.map((item) => (
            <ChecklistRow
              key={item.key}
              item={item}
              size={size}
              onToggleManual={onToggleManual}
            />
          ))}
        </Flex>
      </Collapse>
    </div>
  );
}

/** The checklist grouped by what each item means for starting. */
export function ChecklistItems({
  summary,
  size,
  showCompleted = false,
  onToggleManual = null,
}: {
  summary: ChecklistSummary;
  size: ChecklistSize;
  showCompleted?: boolean;
  // null when the viewer can't check tasks off.
  onToggleManual?: ((manualKey: string, checked: boolean) => void) | null;
}) {
  const listed = (tier: ChecklistTier) => [
    ...summary.incomplete[tier],
    ...summary.flagged.filter((item) => getChecklistTier(item) === tier),
  ];
  const lists = {
    blocking: listed("blocking"),
    recommended: listed("recommended"),
    optional: listed("optional"),
  };
  const { withFading, isFading, faded } = useFadingCompletions(
    lists,
    summary.complete,
  );
  const sections = CHECKLIST_TIERS.map((tier) => ({
    key: tier,
    title: TIER_TITLES[tier],
    items: withFading(tier),
  }));

  return (
    <Flex direction="column" gap="4">
      {sections
        .filter((section) => section.items.length > 0)
        .map((section) => (
          <Flex key={section.key} direction="column" gap="2">
            <Text size="sm" weight="semibold" color="text-high">
              {section.title}
            </Text>
            {section.items.map((item) => (
              <ChecklistRow
                key={item.key}
                item={item}
                size={size}
                onToggleManual={onToggleManual}
                onFaded={isFading(item.key) ? () => faded(item.key) : null}
              />
            ))}
          </Flex>
        ))}
      {showCompleted && summary.complete.length > 0 ? (
        <CompletedItems
          items={summary.complete}
          size={size}
          onToggleManual={onToggleManual}
        />
      ) : null}
    </Flex>
  );
}

export const todoTitle = (remaining: number | null) =>
  remaining ? `To do (${remaining})` : "To do";

export function ChecklistTodoHeading({
  remaining,
}: {
  remaining: number | null;
}) {
  return (
    <Text size="sm" weight="medium" color="text-low" textTransform="uppercase">
      {todoTitle(remaining)}
    </Text>
  );
}

export function PreLaunchChecklistPanel() {
  const { summary, loading, loadError, toggleManualItem, toggleError } =
    usePreLaunchChecklist();
  if (loading) return <LoadingSpinner />;

  return (
    <Flex direction="column" gap="3">
      {loadError ? (
        loadErrorNotice
      ) : summary.remaining === 0 ? (
        <Callout
          status="success"
          size="sm"
          icon={<PiCheckBold />}
          mt="-1"
          mb="1"
        >
          All items are complete.
        </Callout>
      ) : null}
      <ChecklistItems
        summary={summary}
        size="sm"
        showCompleted
        onToggleManual={toggleManualItem}
      />
      {toggleError ? (
        <HelperText status="error" size="sm">
          {toggleError}
        </HelperText>
      ) : null}
    </Flex>
  );
}

export function PreLaunchChecklistForDraftFeature({
  experiment,
  feature,
  mutateExperiment,
  onReady,
  details,
}: {
  experiment: ExperimentInterfaceStringDates;
  feature: FeatureInterface;
  mutateExperiment: () => unknown | Promise<unknown>;
  onReady?: (status: ChecklistReadyStatus) => void;
  // Under the name, as the start popover has its schedule.
  details: ReactNode;
}) {
  const {
    checklist: customChecklist,
    connections,
    loading: checklistLoading,
    loadError,
  } = useLaunchChecklistData(experiment);

  const { data: experimentData, error: experimentError } = useApi<{
    linkedFeatures: LinkedFeatureInfo[];
  }>(`/experiment/${experiment.id}`);

  const isLoading = checklistLoading || (!experimentData && !experimentError);

  const summary = useMemo(
    () =>
      summarizeChecklist(
        getChecklistItems({
          experiment,
          linkedFeatures: experimentData?.linkedFeatures ?? [],
          visualChangesets: [],
          checklist: customChecklist,
          connections,
          publishingFeatureId: feature.id,
        }),
      ),
    [experiment, experimentData, customChecklist, connections, feature.id],
  );

  const hasHardBlockers = summary.blocking > 0;
  const hasSoftBlockers = summary.remaining > summary.blocking;

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    onReadyRef.current?.({
      hasHardBlockers,
      hasSoftBlockers,
      loading: isLoading,
    });
  }, [hasHardBlockers, hasSoftBlockers, isLoading]);

  const { canEdit } = useExperimentEditing(experiment);
  const { toggle, error: toggleError } = useManualChecklistToggle(
    experiment,
    mutateExperiment,
  );

  if (isLoading) {
    return <LoadingSpinner />;
  }

  const showTodo =
    experiment.status === "draft" &&
    (summary.remaining > 0 || loadError || summary.flagged.length > 0);

  return (
    <Flex direction="column" gap="3">
      <Heading as="h4" size="sm" mb="0">
        <Link href={`/experiment/${experiment.id}`} external>
          {experiment.name}
        </Link>
      </Heading>
      {details}
      {showTodo ? (
        <>
          <Separator size="4" />
          <ChecklistTodoHeading remaining={summary.remaining} />
          {loadError ? loadErrorNotice : null}
          <ChecklistItems
            summary={summary}
            size="sm"
            showCompleted
            onToggleManual={canEdit ? toggle : null}
          />
        </>
      ) : null}
      {toggleError ? (
        <HelperText status="error" size="sm">
          {toggleError}
        </HelperText>
      ) : null}
    </Flex>
  );
}
