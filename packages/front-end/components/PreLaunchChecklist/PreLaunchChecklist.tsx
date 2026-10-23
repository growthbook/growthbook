import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { PiArrowSquareOut, PiCheckBold } from "react-icons/pi";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import { format } from "date-fns-tz";
import clsx from "clsx";
import { Flex } from "@radix-ui/themes";
import NextLink from "next/link";
import Link from "@/ui/Link";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "@/components/LoadingSpinner";
import useSDKConnections from "@/hooks/useSDKConnections";
import useExperimentEditing from "@/components/Experiment/TabbedPage/useExperimentEditing";
import Callout from "@/ui/Callout";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import Checkbox from "@/ui/Checkbox";
import Badge from "@/ui/Badge";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import styles from "./PreLaunchChecklist.module.scss";
import { usePreLaunchChecklist } from "./PreLaunchChecklistProvider";
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

// The rail's type scale, or a modal's and a page's.
type ChecklistSize = "sm" | "md";

const TIER_TITLES: Record<ChecklistTier, string> = {
  blocking: "Must resolve",
  recommended: "Recommended",
  optional: "Optional",
};

// Stretched over its row, so the whole row takes the action.
function ChecklistRowAction({
  action,
  children,
}: {
  action: ChecklistAction;
  children: ReactNode;
}) {
  if ("onClick" in action) {
    return (
      <button
        type="button"
        className={styles.rowAction}
        data-checklist-action=""
        onClick={action.onClick}
      >
        {children}
      </button>
    );
  }
  if (!action.external) {
    return (
      <NextLink
        href={action.href}
        className={styles.rowAction}
        data-checklist-action=""
      >
        {children}
      </NextLink>
    );
  }
  return (
    <a
      href={action.href}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.rowAction}
      data-checklist-action=""
    >
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
  // To read, not act on: no ticking, no action.
  readOnly?: boolean;
}) {
  const complete = item.status === "complete";
  const manualKey = item.type === "manual" ? item.manualKey : undefined;
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
            ? "Automatically detected and marked as 'complete' when task is finished"
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

/**
 * Items just ticked off stay in their sections, ticked, until they've faded
 * out of them. They're under Completed from the start.
 */
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

/** Checklist rows to read, not act on. */
export function ReadOnlyChecklistRows({
  items,
  size,
}: {
  items: CheckListItem[];
  size: ChecklistSize;
}) {
  return (
    <Flex direction="column" gap="2">
      {items.map((item) => (
        <ChecklistRow
          key={item.key}
          item={item}
          size={size}
          onToggleManual={null}
          readOnly
        />
      ))}
    </Flex>
  );
}

// Done items, in a last section that starts shut.
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

export function ChecklistCountBadge({
  remaining,
  blocking,
}: {
  // null while loading.
  remaining: number | null;
  blocking: boolean;
}) {
  if ((remaining ?? 0) === 0) return null;
  return (
    <Badge
      size="xs"
      color={blocking ? "red" : "amber"}
      radius="full"
      label={`${remaining}`}
      style={{ justifyContent: "center", textAlign: "center" }}
    />
  );
}

/** The details rail's To Do tab, or the start popover's To Do. */
export function PreLaunchChecklistPanel({
  size = "sm",
}: {
  size?: ChecklistSize;
}) {
  const {
    experiment,
    summary,
    loading,
    loadError,
    toggleManualItem,
    toggleError,
  } = usePreLaunchChecklist();
  if (loading) return <LoadingSpinner />;

  const scheduledStart =
    experiment.nextScheduledStatusUpdate?.type === "start" &&
    experiment.nextScheduledStatusUpdate.date
      ? new Date(experiment.nextScheduledStatusUpdate.date)
      : null;

  return (
    <>
      {scheduledStart ? (
        <Callout status="info" size={size}>
          Scheduled to start{" "}
          {format(scheduledStart, "MMM d, yyyy 'at' h:mm a (z)")}. Editing the
          schedule clears this approval.
        </Callout>
      ) : loadError ? (
        <HelperText status="warning" size={size}>
          Couldn&apos;t load the custom checklist. Built-in items are shown.
        </HelperText>
      ) : summary.remaining === 0 ? (
        <Callout status="success" size="sm" icon={<PiCheckBold />}>
          All items are complete.
        </Callout>
      ) : null}
      <ChecklistItems
        summary={summary}
        size={size}
        showCompleted
        onToggleManual={toggleManualItem}
      />
      {toggleError ? (
        <HelperText status="error" size={size}>
          {toggleError}
        </HelperText>
      ) : null}
    </>
  );
}

export function PreLaunchChecklistForDraftFeature({
  experiment,
  feature,
  mutateExperiment,
  onReady,
}: {
  experiment: ExperimentInterfaceStringDates;
  feature: FeatureInterface;
  mutateExperiment: () => unknown | Promise<unknown>;
  onReady?: (status: ChecklistReadyStatus) => void;
}) {
  const { data: checklistData, error: checklistError } = useApi<{
    checklist: ExperimentLaunchChecklistInterface;
  }>(`/experiment/${experiment.id}/launch-checklist`);

  const { data: experimentData, error: experimentError } = useApi<{
    linkedFeatures: LinkedFeatureInfo[];
  }>(`/experiment/${experiment.id}`);

  const { data: sdkConnectionsData, error: sdkError } = useSDKConnections();
  const connections = useMemo(
    () =>
      (sdkConnectionsData?.connections ?? []).filter(
        (c) =>
          !c.projects.length || c.projects.includes(experiment.project || ""),
      ),
    [sdkConnectionsData, experiment.project],
  );

  const isLoading =
    (!checklistData && !checklistError) ||
    (!experimentData && !experimentError) ||
    (!sdkConnectionsData && !sdkError);

  const checklist = useMemo(
    () =>
      getChecklistItems({
        experiment,
        linkedFeatures: experimentData?.linkedFeatures ?? [],
        visualChangesets: [],
        checklist: checklistData?.checklist,
        connections,
        publishingFeatureId: feature.id,
      }),
    [experiment, experimentData, checklistData, connections, feature.id],
  );
  const summary = useMemo(() => summarizeChecklist(checklist), [checklist]);

  const hasHardBlockers = summary.blocking > 0;
  // Optional items don't hold the publish back here.
  const hasSoftBlockers = summary.incomplete.recommended.length > 0;

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

  return (
    <>
      {experiment.status === "draft" ? (
        <>
          <Flex align="center" gap="2" mb="3">
            <Heading as="h4" size="sm" mb="0">
              <Link href={`/experiment/${experiment.id}`} external>
                {experiment.name}
              </Link>
            </Heading>
            <ChecklistCountBadge
              remaining={summary.remaining}
              blocking={hasHardBlockers}
            />
          </Flex>
          <ChecklistItems
            summary={summary}
            size="md"
            onToggleManual={canEdit ? toggle : null}
          />
        </>
      ) : null}
      {toggleError ? (
        <HelperText status="error" mt="2">
          {toggleError}
        </HelperText>
      ) : null}
      {hasHardBlockers ? (
        <Callout status="error" my="3">
          Please complete all required items to publish and start this
          experiment.
        </Callout>
      ) : hasSoftBlockers ? (
        <Callout status="warning" my="3">
          Some recommended items are incomplete. Complete them first, or
          acknowledge them to continue.
        </Callout>
      ) : (
        <Callout status="success" my="3">
          All required items are complete. The experiment is ready to start.
        </Callout>
      )}
    </>
  );
}
