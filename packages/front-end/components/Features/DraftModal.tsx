import { FeatureInterface } from "shared/types/feature";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import React, { useState, useMemo } from "react";
import { FaAngleDown, FaAngleRight, FaArrowLeft } from "react-icons/fa";
import { PiLockSimple } from "react-icons/pi";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { RampScheduleInterface } from "shared/validators";
import {
  autoMerge,
  fillRevisionFromFeature,
  liveRevisionFromFeature,
  filterEnvironmentsByFeature,
  getAffectedEnvsForExperiment,
  mergeResultHasChanges,
} from "shared/util";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Flex, Box } from "@radix-ui/themes";
import { format } from "date-fns";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import {
  getAffectedRevisionEnvs,
  useEnvironments,
  useFeatureExperimentChecklists,
} from "@/services/features";
import { getFutureScheduledStartDate } from "@/services/experiments";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Button from "@/components/Button";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import {
  useFeatureRevisionDiff,
  featureToFeatureRevisionDiffInput,
  type FeatureRevisionDiff,
} from "@/hooks/useFeatureRevisionDiff";
import Badge from "@/ui/Badge";
import {
  logBadgeColor,
  CreatedRampScheduleBody,
  RampActionLabel,
  formatSimpleWindow,
} from "@/components/Features/FeatureDiffRenders";
import { useHoldouts, holdoutOccupiesRuleSlot } from "@/hooks/useHoldouts";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import { PreLaunchChecklistForDraft } from "@/components/Experiment/PreLaunchChecklist";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";

export interface Props {
  feature: FeatureInterface;
  version: number;
  revisions: FeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  onPublish?: () => void;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
  rampSchedules?: RampScheduleInterface[];
}

export function ExpandableDiff({
  title,
  a,
  b,
  defaultOpen = false,
  styles,
  leftTitle,
  rightTitle,
}: {
  title: string;
  a: string;
  b: string;
  defaultOpen?: boolean;
  styles?: object;
  leftTitle?: string | React.ReactElement;
  rightTitle?: string | React.ReactElement;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (a === b) return null;

  return (
    <Box className="diff-wrapper appbox bg-light">
      <Flex
        align="center"
        className=""
        p="3"
        style={{
          cursor: "pointer",
          borderBottom: open ? "1px solid var(--gray-5)" : undefined,
        }}
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
      >
        <Text mr="2">Changed:</Text>
        <Text weight="semibold">{title}</Text>
        <Box style={{ marginLeft: "auto" }}>
          {open ? <FaAngleDown /> : <FaAngleRight />}
        </Box>
      </Flex>
      {open && (
        <Box p="3" className="">
          <ReactDiffViewer
            oldValue={a}
            newValue={b}
            compareMethod={DiffMethod.LINES}
            styles={styles ?? { contentText: { wordBreak: "break-all" } }}
            leftTitle={leftTitle}
            rightTitle={rightTitle}
          />
        </Box>
      )}
    </Box>
  );
}

export default function DraftModal({
  feature,
  version,
  revisions,
  close,
  mutate,
  onPublish,
  experimentsMap,
  rampSchedules,
}: Props) {
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const permissionsUtil = usePermissionsUtil();

  const { apiCall } = useAuth();

  const revision = revisions.find((r) => r.version === version);
  const baseRevision = revisions.find(
    (r) => r.version === revision?.baseVersion,
  );
  const liveRevision = revisions.find((r) => r.version === feature.version);
  const envIds = environments.map((e) => e.id);
  const { holdoutsMap } = useHoldouts();

  const mergeResult = useMemo(() => {
    if (!revision || !baseRevision || !liveRevision) return null;
    return autoMerge(
      liveRevisionFromFeature(liveRevision, feature),
      fillRevisionFromFeature(baseRevision, feature),
      revision,
      envIds,
      {},
    );
  }, [revision, baseRevision, liveRevision, envIds, feature]);

  const [comment, setComment] = useState(revision?.comment || "");
  const [adminPublish, setAdminPublish] = useState(false);

  const canAdminPublish = permissionsUtil.canBypassApprovalChecks(feature);

  const { experiments, immediateStartExperiments, scheduledExperiments } =
    useFeatureExperimentChecklists({
      feature,
      revision,
      experimentsMap,
    });

  const [selectedExperiments, setSelectedExperiments] = useState(
    new Set(experiments.map((e) => e.id)),
  );
  const [experimentsStep, setExperimentsStep] = useState(false);

  const selectedImmediateCount = immediateStartExperiments.filter((e) =>
    selectedExperiments.has(e.id),
  ).length;
  const selectedScheduledCount = scheduledExperiments.filter((e) =>
    selectedExperiments.has(e.id),
  ).length;
  const onlyScheduledSelected =
    selectedImmediateCount === 0 && selectedScheduledCount > 0;

  const currentRevisionData = featureToFeatureRevisionDiffInput(feature);
  const resultDiffs = useFeatureRevisionDiff({
    current: currentRevisionData,
    draft: mergeResult?.success
      ? {
          // Use current values as fallback when merge result doesn't have changes
          defaultValue:
            mergeResult.result.defaultValue ?? currentRevisionData.defaultValue,
          rules: mergeResult.result.rules ?? currentRevisionData.rules,
          // Only include envelope fields if they were part of the merge result
          ...(mergeResult.result.environmentsEnabled !== undefined
            ? { environmentsEnabled: mergeResult.result.environmentsEnabled }
            : {}),
          ...(mergeResult.result.prerequisites !== undefined
            ? { prerequisites: mergeResult.result.prerequisites }
            : {}),
          ...(mergeResult.result.archived !== undefined
            ? { archived: mergeResult.result.archived }
            : {}),
          ...("holdout" in mergeResult.result
            ? { holdout: mergeResult.result.holdout }
            : {}),
          ...(mergeResult.result.metadata !== undefined
            ? {
                metadata: {
                  ...currentRevisionData.metadata,
                  ...mergeResult.result.metadata,
                },
              }
            : {}),
          // Pending ramp create/detach actions live on the draft revision —
          // pass through so the rules diff annotates affected rules.
          rampActions: revision?.rampActions ?? undefined,
        }
      : currentRevisionData,
  });

  // Exclude no-op diffs (e.g. semantic equality but different raw strings)
  const resultDiffsWithChanges = useMemo(
    () => resultDiffs.filter((d) => d.a !== d.b),
    [resultDiffs],
  );

  // Activating ramps: pending ramps where this revision's publication triggers the start lifecycle.
  const activatingRamps = (rampSchedules ?? []).filter(
    (r) =>
      r.status === "pending" &&
      r.targets.some(
        (t) =>
          t.entityId === feature.id &&
          t.activatingRevisionVersion === revision?.version,
      ),
  );

  // 1-based rule indices for `Rule #N` refs. Holdout occupies #1 (Rule.tsx)
  // only when it's enabled in some env — a feature may carry a disabled
  // holdout reference, in which case the rules list shows no holdout row.
  const draftRules = Array.isArray(revision?.rules) ? revision!.rules : [];
  const draftRuleNumberOffset = holdoutOccupiesRuleSlot(
    revision?.holdout,
    holdoutsMap,
  )
    ? 2
    : 1;
  const draftRuleIndexById = new Map<string, number>(
    draftRules.map((r, i) => [r.id, i + draftRuleNumberOffset]),
  );
  // Fall back to the raw ID for any rule we can't number (e.g. a detach
  // action whose rule was deleted from the draft).
  const ruleRef = (ruleId: string): string => {
    const idx = draftRuleIndexById.get(ruleId);
    return idx ? `Rule #${idx}` : `Rule ${ruleId}`;
  };

  // Build extra diff items so ramp changes appear in badges, custom renders, and JSON diffs.
  const rampDiffs: FeatureRevisionDiff[] = [
    ...activatingRamps.map((ramp) => {
      const rampConfig = {
        name: ramp.name,
        targets: ramp.targets,
        startDate: ramp.startDate,
        steps: ramp.steps,
        cutoffDate: ramp.cutoffDate,
      };
      const isSimple = ramp.steps.length === 0;
      const kindLabel = isSimple ? "Schedule" : "Ramp Schedule";
      const endAt = ramp.cutoffDate ?? undefined;
      const detail = isSimple
        ? (formatSimpleWindow(ramp.startDate, endAt) ?? "starts on publish")
        : `${ramp.steps.length} step${ramp.steps.length !== 1 ? "s" : ""}${
            ramp.startDate ? "" : " · starts on publish"
          }`;
      return {
        title: `${kindLabel} – ${ramp.name}`,
        titleSuffix: <RampActionLabel action="activate" />,
        a: "",
        b: JSON.stringify(rampConfig, null, 2),
        customRender: detail ? (
          <p className="mb-0 text-muted">{detail}.</p>
        ) : null,
        badges: [{ label: `Start ramp: ${ramp.name}`, action: "start ramp" }],
      } as FeatureRevisionDiff;
    }),
    // Pending ramp actions: create/update/detach actions queued in the draft
    ...(revision?.rampActions ?? [])
      .map((action) => {
        if (action.mode === "create") {
          const rampConfig = {
            name: action.name,
            environment: action.environment,
            ruleId: action.ruleId,
            startDate: action.startDate,
            steps: action.steps,
            cutoffDate: action.cutoffDate,
          };
          const targetIdx = draftRuleIndexById.get(action.ruleId);
          const isSimple = action.steps.length === 0;
          const kindLabel = isSimple ? "Schedule" : "Ramp Schedule";
          const displayName = action.name ?? "schedule";
          return {
            title: `${kindLabel} – ${displayName}`,
            a: "",
            b: JSON.stringify(rampConfig, null, 2),
            customRender: (
              <CreatedRampScheduleBody
                action={action}
                targetRuleIndices={targetIdx ? [targetIdx] : []}
              />
            ),
            titleSuffix: <RampActionLabel action="create" />,
            badges: [
              {
                label: action.name
                  ? `Create ${isSimple ? "schedule" : "ramp"}: ${action.name}`
                  : `Create ${isSimple ? "schedule" : "ramp schedule"}`,
                action: isSimple ? "create schedule" : "create ramp",
              },
            ],
          } as FeatureRevisionDiff;
        } else if (action.mode === "update") {
          const rampConfig = {
            rampScheduleId: action.rampScheduleId,
            name: action.name,
            ruleId: action.ruleId,
            startDate: action.startDate,
            steps: action.steps,
            cutoffDate: action.cutoffDate,
          };
          const isSimpleUpdate = action.steps.length === 0;
          const kindLabelUpdate = isSimpleUpdate ? "Schedule" : "Ramp Schedule";
          const displayName = action.name ?? "schedule";
          return {
            title: `${kindLabelUpdate} – ${displayName}`,
            titleSuffix: <RampActionLabel action="update" />,
            a: "",
            b: JSON.stringify(rampConfig, null, 2),
            customRender: (
              <p className="mb-0 text-muted">
                {ruleRef(action.ruleId)} · updates schedule configuration.
              </p>
            ),
            badges: [
              {
                label: isSimpleUpdate
                  ? "Update schedule"
                  : "Update ramp schedule",
                action: "update ramp",
              },
            ],
          } as FeatureRevisionDiff;
        } else if (action.mode === "detach") {
          const targetSchedule = (rampSchedules ?? []).find(
            (r) => r.id === action.rampScheduleId,
          );
          const isSimple =
            !!targetSchedule && targetSchedule.steps.length === 0;
          const kindLabel = isSimple ? "Schedule" : "Ramp Schedule";
          const kindNoun = isSimple ? "schedule" : "ramp schedule";
          const scheduleName = targetSchedule?.name;
          return {
            title: scheduleName ? `${kindLabel} – ${scheduleName}` : kindLabel,
            titleSuffix: <RampActionLabel action="remove" />,
            a: "",
            b: JSON.stringify(
              {
                rampScheduleId: action.rampScheduleId,
                ruleId: action.ruleId,
              },
              null,
              2,
            ),
            customRender: (
              <p className="mb-0 text-muted">
                {ruleRef(action.ruleId)} will be removed from this {kindNoun}
                {action.deleteScheduleWhenEmpty &&
                  "; the schedule is deleted if no targets remain"}
                .
              </p>
            ),
            badges: [
              {
                label: `Remove from ${kindNoun}`,
                action: isSimple ? "remove schedule" : "remove ramp",
              },
            ],
          } as FeatureRevisionDiff;
        }
        return null as unknown as FeatureRevisionDiff;
      })
      .filter(Boolean),
  ];

  // Combined for rendering convenience
  const linkedRamps = [
    ...activatingRamps.map((ramp) => ({ ramp, role: "activating" as const })),
  ];

  if (!revision || !mergeResult) return null;

  const allDiffsWithChanges = [...resultDiffsWithChanges, ...rampDiffs];

  const hasPermission = permissionsUtil.canPublishFeature(
    feature,
    getAffectedRevisionEnvs(feature, revision, environments),
  );

  const hasChanges = mergeResultHasChanges(mergeResult) || rampDiffs.length > 0;

  const featureLockedByRamp =
    rampSchedules?.some(
      (rs) => rs.lockdownConfig?.mode === "locked" && rs.status === "running",
    ) ?? false;

  // Users who reach DraftModal already have direct publish permission, so the
  // checklist is advisory — it does not block publishing.
  const submitEnabled =
    !!mergeResult.success &&
    hasChanges &&
    (!featureLockedByRamp || adminPublish);

  // If we're publishing experiments, next step is to review pre-launch checklists
  const hasNextStep =
    !!mergeResult.success &&
    hasChanges &&
    selectedExperiments.size > 0 &&
    !experimentsStep;

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      header={"Review Draft Changes"}
      useRadixButton={true}
      submit={
        hasPermission
          ? async () => {
              if (hasNextStep) {
                setExperimentsStep(true);
                return;
              }

              try {
                await apiCall(
                  `/feature/${feature.id}/${revision.version}/publish`,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      mergeResultSerialized: JSON.stringify(mergeResult),
                      publishExperimentIds: Array.from(selectedExperiments),
                      comment,
                      adminOverride: adminPublish,
                    }),
                  },
                );
              } catch (e) {
                await mutate();
                throw e;
              }
              await mutate();
              onPublish && onPublish();
              close();
            }
          : undefined
      }
      cta={
        hasNextStep ? (
          <>
            Next <FaAngleRight />
          </>
        ) : featureLockedByRamp ? (
          <>
            <PiLockSimple /> Publish
          </>
        ) : onlyScheduledSelected ? (
          "Schedule to Start"
        ) : (
          "Publish"
        )
      }
      ctaEnabled={submitEnabled}
      close={close}
      closeCta="Cancel"
      size="max"
      autoCloseOnSubmit={false}
      backCTA={
        experimentsStep ? (
          <Button
            color="link"
            onClick={() => {
              setExperimentsStep(false);
            }}
          >
            <FaArrowLeft /> Back
          </Button>
        ) : undefined
      }
    >
      {featureLockedByRamp && (
        <Callout status="warning" icon={<PiLockSimple size={15} />} mb="3">
          Publishing is locked by an active ramp-up schedule.
          {canAdminPublish
            ? " Use the admin bypass below to publish anyway."
            : ""}
        </Callout>
      )}
      {canAdminPublish && featureLockedByRamp && (
        <div className="mt-3 mb-4 ml-1">
          <Checkbox
            label="Bypass lockdown to publish (admin only)"
            value={adminPublish}
            setValue={(val) => {
              setAdminPublish(!!val);
            }}
          />
        </div>
      )}
      {mergeResult.conflicts.length > 0 && (
        <Callout status="error">
          <strong>Conflicts Detected</strong>. Please fix conflicts before
          publishing this draft.
        </Callout>
      )}

      {linkedRamps.map(({ ramp }) => (
        <Callout key={ramp.id} status="info" mb="3">
          Publishing this draft will activate ramp schedule{" "}
          <strong>{ramp.name}</strong>. The ramp will begin once this revision
          is live.
        </Callout>
      ))}

      {!hasChanges && !mergeResult.conflicts.length && (
        <Callout status="info">
          There are no changes to publish. Either discard the draft or add
          changes first before publishing.
        </Callout>
      )}

      {mergeResult.success &&
        hasChanges &&
        (experimentsStep ? (
          <Box>
            <Heading as="h3" size="medium" mb="3">
              Review &amp; {onlyScheduledSelected ? "Schedule" : "Publish"}
            </Heading>
            <Text as="p" mb="3">
              Please review the{" "}
              <strong>
                Pre-Launch Checklist
                {selectedExperiments.size !== 1 ? "s" : ""}
              </strong>{" "}
              for the experiment
              {selectedExperiments.size !== 1 ? "s" : ""} that will be{" "}
              {onlyScheduledSelected ? "scheduled to start" : "published"} along
              with this draft.
            </Text>
            {experiments.map((experiment) => {
              if (!selectedExperiments.has(experiment.id)) return null;

              const scheduledStartDate =
                getFutureScheduledStartDate(experiment);

              return (
                <Box key={experiment.id} mb="3">
                  {scheduledStartDate && (
                    <Callout status="info" mb="2">
                      <strong>{experiment.name}</strong> will start on{" "}
                      <strong>
                        {format(scheduledStartDate, "MMM d, yyyy 'at' h:mm a")}
                      </strong>
                      .
                    </Callout>
                  )}
                  <PreLaunchChecklistForDraft
                    experiment={experiment}
                    feature={feature}
                    mutateExperiment={mutate}
                    envs={getAffectedEnvsForExperiment({
                      experiment,
                      orgEnvironments: allEnvironments,
                      linkedFeatures: [],
                    })}
                  />
                </Box>
              );
            })}
          </Box>
        ) : (
          <Box>
            <Heading as="h3" size="medium" mb="3">
              Review &amp; Publish
            </Heading>
            <Text as="p" mb="3">
              The changes below will go live when this draft revision is
              published. You will be able to revert later if needed.
            </Text>

            {experiments.length > 0 ? (
              <Box mb="3">
                {immediateStartExperiments.length > 0 && (
                  <Box mb={scheduledExperiments.length > 0 ? "3" : "0"}>
                    <Heading as="h4" size="small" mb="2">
                      Start running experiments upon publishing:
                    </Heading>
                    {immediateStartExperiments.map((experiment) => (
                      <Box key={experiment.id}>
                        <Checkbox
                          value={selectedExperiments.has(experiment.id)}
                          setValue={(e) => {
                            const newValue = new Set(selectedExperiments);
                            if (e === true) {
                              newValue.add(experiment.id);
                            } else {
                              newValue.delete(experiment.id);
                            }
                            setSelectedExperiments(newValue);
                          }}
                          label={experiment.name}
                        />
                      </Box>
                    ))}
                  </Box>
                )}
                {scheduledExperiments.length > 0 && (
                  <Box>
                    <Heading as="h4" size="small" mb="2">
                      Approve scheduled start for experiments:
                    </Heading>
                    {scheduledExperiments.map((experiment) => (
                      <Box key={experiment.id}>
                        <Checkbox
                          value={selectedExperiments.has(experiment.id)}
                          setValue={(e) => {
                            const newValue = new Set(selectedExperiments);
                            if (e === true) {
                              newValue.add(experiment.id);
                            } else {
                              newValue.delete(experiment.id);
                            }
                            setSelectedExperiments(newValue);
                          }}
                          label={experiment.name}
                        />
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            ) : null}

            {allDiffsWithChanges.length > 0 && (
              <>
                <Heading as="h4" size="small" mb="3">
                  Summary of changes
                </Heading>
                {allDiffsWithChanges.flatMap((d) => d.badges ?? []).length >
                  0 && (
                  <Flex wrap="wrap" gap="2" mb="3">
                    {allDiffsWithChanges
                      .flatMap((d) => d.badges ?? [])
                      .map(({ label, action }) => (
                        <Badge
                          key={label}
                          color={logBadgeColor(action)}
                          variant="soft"
                          label={label}
                        />
                      ))}
                  </Flex>
                )}
                {allDiffsWithChanges.some((d) => d.customRender) && (
                  <Box
                    mb="4"
                    className="appbox bg-light"
                    style={{
                      overflow: "hidden",
                    }}
                  >
                    {allDiffsWithChanges
                      .filter((d) => d.customRender)
                      .map((d, i, arr) => (
                        <Box
                          key={d.title}
                          p="3"
                          style={{
                            borderBottom:
                              i === arr.length - 1
                                ? undefined
                                : "1px solid var(--gray-5)",
                          }}
                        >
                          <Flex align="center" gap="2" mb="2" wrap="wrap">
                            <Text as="div" weight="semibold">
                              {d.title}
                            </Text>
                            {d.titleSuffix}
                          </Flex>
                          {d.customRender}
                        </Box>
                      ))}
                  </Box>
                )}
              </>
            )}
            <Heading as="h4" size="medium" mb="3">
              Change details
            </Heading>
            <Box
              mb="4"
              style={{
                overflow: "hidden",
              }}
            >
              {allDiffsWithChanges.map((diff) => (
                <ExpandableDiff
                  key={diff.title}
                  title={diff.title}
                  a={diff.a}
                  b={diff.b}
                  styles={COMPACT_DIFF_STYLES}
                />
              ))}
            </Box>
            {hasPermission ? (
              <Field
                label="Notes (optional)"
                textarea
                placeholder="Summary of changes..."
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                }}
              />
            ) : (
              <Callout status="info">
                You do not have permission to publish this draft.
              </Callout>
            )}
          </Box>
        ))}
    </Modal>
  );
}
