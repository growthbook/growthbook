import { FeatureInterface } from "shared/types/feature";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import React, { useState, useMemo } from "react";
import { FaAngleDown, FaAngleRight, FaArrowLeft } from "react-icons/fa";
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
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import {
  getAffectedRevisionEnvs,
  useEnvironments,
  useFeatureExperimentChecklists,
} from "@/services/features";
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
import { logBadgeColor } from "@/components/Features/FeatureDiffRenders";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import { PreLaunchChecklistFeatureExpRule } from "@/components/Experiment/PreLaunchChecklist";
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

  const { experimentData } = useFeatureExperimentChecklists({
    feature,
    revision,
    experimentsMap,
  });

  const [selectedExperiments, setSelectedExperiments] = useState(
    new Set(experimentData.map((e) => e.experiment.id)),
  );
  const [experimentsStep, setExperimentsStep] = useState(false);

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

  // Build extra diff items so ramp changes appear in badges, custom renders, and JSON diffs.
  const rampDiffs: FeatureRevisionDiff[] = [
    ...activatingRamps.map((ramp) => {
      const rampConfig = {
        name: ramp.name,
        targets: ramp.targets,
        startDate: ramp.startDate,
        steps: ramp.steps,
        endCondition: ramp.endCondition,
      };
      const startDescription = ramp.startDate
        ? "Starts at a scheduled date/time."
        : "Starts automatically on publish.";
      return {
        title: `Ramp Schedule – ${ramp.name}`,
        a: "",
        b: JSON.stringify(rampConfig, null, 2),
        customRender: (
          <p className="mb-0">
            Activates ramp schedule <strong>{ramp.name}</strong> —{" "}
            {ramp.steps.length} step{ramp.steps.length !== 1 ? "s" : ""}.{" "}
            {startDescription}
          </p>
        ),
        badges: [{ label: `Start ramp: ${ramp.name}`, action: "start ramp" }],
      } as FeatureRevisionDiff;
    }),
    // Pending ramp actions: create/detach actions queued in the draft
    ...(revision?.rampActions ?? [])
      .map((action) => {
        if (action.mode === "create") {
          const rampConfig = {
            name: action.name,
            environment: action.environment,
            ruleId: action.ruleId,
            startDate: action.startDate,
            steps: action.steps,
            endCondition: action.endCondition,
          };
          return {
            title: `Ramp Schedule – ${action.name} (pending creation)`,
            a: "",
            b: JSON.stringify(rampConfig, null, 2),
            customRender: (
              <p className="mb-0">
                Creates ramp schedule <strong>{action.name}</strong> for rule{" "}
                <code>{action.ruleId}</code> — {action.steps.length} step
                {action.steps.length !== 1 ? "s" : ""}.
              </p>
            ),
            badges: [
              {
                label: `Create ramp: ${action.name}`,
                action: "create ramp",
              },
            ],
          } as FeatureRevisionDiff;
        } else if (action.mode === "detach") {
          return {
            title: `Remove from Ramp Schedule (pending)`,
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
              <p className="mb-0">
                This rule will be removed from its ramp schedule
                {action.deleteScheduleWhenEmpty &&
                  " and the schedule will be deleted if empty"}
                .
              </p>
            ),
            badges: [
              {
                label: "Remove from ramp schedule",
                action: "remove ramp",
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

  let submitEnabled = !!mergeResult.success && hasChanges;
  if (experimentsStep && experimentData.some((d) => d.failedRequired)) {
    submitEnabled = false;
  }

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
              Review &amp; Publish
            </Heading>
            <Text as="p" mb="3">
              Please review the <strong>Pre-Launch Checklists</strong> for the
              experiments that will be published along with this draft.
            </Text>
            {experimentData.map(({ experiment, checklist }) => {
              if (!selectedExperiments.has(experiment.id)) return null;

              return (
                <Box key={experiment.id} mb="3">
                  <PreLaunchChecklistFeatureExpRule
                    experiment={experiment}
                    mutateExperiment={mutate}
                    checklist={checklist}
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

            {experimentData.length > 0 ? (
              <Box mb="3">
                <Heading as="h4" size="small" mb="2">
                  Start running experiments upon publishing:
                </Heading>
                {experimentData.map(({ experiment }) => (
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
                          <Text as="div" weight="semibold" mb="2">
                            {d.title}
                          </Text>
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
