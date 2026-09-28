import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { PiArrowSquareOut } from "react-icons/pi";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import { format } from "date-fns-tz";
import clsx from "clsx";
import { Flex } from "@radix-ui/themes";
import Link from "@/ui/Link";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "@/components/LoadingSpinner";
import useSDKConnections from "@/hooks/useSDKConnections";
import useExperimentEditing from "@/components/Experiment/TabbedPage/useExperimentEditing";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Badge from "@/ui/Badge";
import Switch from "@/ui/Switch";
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
  blocking: "Must resolve before starting",
  recommended: "Recommended",
  optional: "Optional",
};

function ChecklistActionLink({
  action,
  wrapAction,
  children,
}: {
  action: ChecklistAction;
  wrapAction?: (run: () => void) => void;
  children: ReactNode;
}) {
  if ("onClick" in action) {
    return (
      <Link
        onClick={() =>
          wrapAction ? wrapAction(action.onClick) : action.onClick()
        }
      >
        {children}
      </Link>
    );
  }
  if (!action.external) return <Link href={action.href}>{children}</Link>;
  return (
    <Link href={action.href} external>
      <Flex as="span" display="inline-flex" align="center" gap="1">
        {children}
        <PiArrowSquareOut style={{ flexShrink: 0 }} />
      </Flex>
    </Link>
  );
}

function ChecklistRow({
  item,
  size,
  onToggleManual,
  wrapAction,
}: {
  item: CheckListItem;
  size: ChecklistSize;
  onToggleManual: ((manualKey: string, checked: boolean) => void) | null;
  wrapAction?: (run: () => void) => void;
}) {
  const complete = item.status === "complete";
  const manualKey = item.type === "manual" ? item.manualKey : undefined;
  const toggle =
    manualKey && onToggleManual
      ? (checked: boolean) => onToggleManual(manualKey, checked)
      : null;
  const action = !complete || item.warning ? item.action : undefined;
  return (
    <Checkbox
      size={size}
      labelSize={size}
      weight={size === "sm" ? "regular" : undefined}
      value={complete}
      setValue={(checked) => toggle?.(checked)}
      readOnly={!toggle}
      checkboxTooltip={
        item.type === "auto" && !complete
          ? "Automatically detected and marked as 'complete' when task is finished"
          : undefined
      }
      containerClassName={clsx({
        [styles.readonly]: !toggle,
        [styles.readonlyIncomplete]: !toggle && !complete,
      })}
      label={
        <span
          className={clsx({
            [styles.completedLabel]: complete && !item.warning,
          })}
        >
          {action ? (
            <ChecklistActionLink action={action} wrapAction={wrapAction}>
              {item.display}
            </ChecklistActionLink>
          ) : (
            item.display
          )}
        </span>
      }
      description={complete ? undefined : item.description}
      error={item.warning}
      errorLevel="warning"
    />
  );
}

/** The checklist grouped by what each item means for starting. */
export function ChecklistItems({
  summary,
  size,
  showCompleted = false,
  onToggleManual = null,
  wrapAction,
}: {
  summary: ChecklistSummary;
  size: ChecklistSize;
  showCompleted?: boolean;
  // null when the viewer can't check tasks off.
  onToggleManual?: ((manualKey: string, checked: boolean) => void) | null;
  // Runs in-page fixes, e.g. after closing the modal they were opened from.
  wrapAction?: (run: () => void) => void;
}) {
  const sections: { key: string; title: string; items: CheckListItem[] }[] =
    CHECKLIST_TIERS.map((tier) => ({
      key: tier,
      title: TIER_TITLES[tier],
      items: [
        ...summary.incomplete[tier],
        ...summary.flagged.filter((item) => getChecklistTier(item) === tier),
      ],
    }));
  if (showCompleted) {
    sections.push({
      key: "completed",
      title: "Completed",
      items: summary.complete,
    });
  }

  return (
    <Flex direction="column" gap="4">
      {sections
        .filter((section) => section.items.length > 0)
        .map((section) => (
          <Flex key={section.key} direction="column" gap="2">
            {size === "sm" ? (
              <Text
                size="sm"
                weight="medium"
                color="text-low"
                textTransform="uppercase"
              >
                {section.title}
              </Text>
            ) : (
              <Text size="sm" weight="semibold" color="text-high">
                {section.title}
              </Text>
            )}
            {section.items.map((item) => (
              <ChecklistRow
                key={item.key}
                item={item}
                size={size}
                onToggleManual={onToggleManual}
                wrapAction={wrapAction}
              />
            ))}
          </Flex>
        ))}
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

/** The details rail's To Do tab. */
export function PreLaunchChecklistPanel() {
  const {
    experiment,
    summary,
    loading,
    loadError,
    toggleManualItem,
    toggleError,
  } = usePreLaunchChecklist();
  const [showCompleted, setShowCompleted] = useState(false);

  if (loading) return <LoadingSpinner />;

  const scheduledStart =
    experiment.nextScheduledStatusUpdate?.type === "start" &&
    experiment.nextScheduledStatusUpdate.date
      ? new Date(experiment.nextScheduledStatusUpdate.date)
      : null;

  return (
    <>
      {summary.complete.length > 0 ? (
        <Switch
          size="sm"
          value={showCompleted}
          onChange={setShowCompleted}
          label="Show completed"
        />
      ) : null}
      {scheduledStart ? (
        <Callout status="info" size="sm">
          Scheduled to start{" "}
          {format(scheduledStart, "MMM d, yyyy 'at' h:mm a (z)")}. Editing the
          schedule clears this approval.
        </Callout>
      ) : loadError ? (
        <HelperText status="warning" size="sm">
          Couldn&apos;t load the custom checklist. Built-in items are shown.
        </HelperText>
      ) : summary.remaining === 0 ? (
        <Callout status="success" size="sm">
          All items are complete.
        </Callout>
      ) : null}
      <ChecklistItems
        summary={summary}
        size="sm"
        showCompleted={showCompleted}
        onToggleManual={toggleManualItem}
      />
      {toggleError ? (
        <HelperText status="error" size="sm">
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
