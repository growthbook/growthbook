import { FeatureInterface } from "shared/types/feature";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import React, { useState, useMemo } from "react";
import { FaAngleDown, FaAngleRight, FaArrowLeft } from "react-icons/fa";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  autoMerge,
  filterEnvironmentsByFeature,
  getAffectedEnvsForExperiment,
  mergeResultHasChanges,
} from "shared/util";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
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
} from "@/hooks/useFeatureRevisionDiff";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import { PreLaunchChecklistFeatureExpRule } from "@/components/Experiment/PreLaunchChecklist";

export interface Props {
  feature: FeatureInterface;
  version: number;
  revisions: FeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  onPublish?: () => void;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
}

export function ExpandableDiff({
  title,
  a,
  b,
  defaultOpen = false,
  styles,
  customRender,
}: {
  title: string;
  a: string;
  b: string;
  defaultOpen?: boolean;
  styles?: object;
  customRender?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (a === b) return null;

  return (
    <div className="diff-wrapper">
      {customRender && (
        <div className="list-group-item list-group-item-light pb-3">
          {customRender}
        </div>
      )}
      <div
        className="list-group-item list-group-item-action d-flex"
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
      >
        <div className="text-muted mr-2">Changed:</div>
        <strong>{title}</strong>
        <div className="ml-auto">
          {open ? <FaAngleDown /> : <FaAngleRight />}
        </div>
      </div>
      {open && (
        <div className="list-group-item list-group-item-light">
          <ReactDiffViewer
            oldValue={a}
            newValue={b}
            compareMethod={DiffMethod.LINES}
            styles={styles ?? { contentText: { wordBreak: "break-all" } }}
          />
        </div>
      )}
    </div>
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
    return autoMerge(liveRevision, baseRevision, revision, envIds, {});
  }, [revision, baseRevision, liveRevision, envIds]);

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
        }
      : currentRevisionData,
  });

  if (!revision || !mergeResult) return null;

  const hasPermission = permissionsUtil.canPublishFeature(
    feature,
    getAffectedRevisionEnvs(feature, revision, environments),
  );

  const hasChanges = mergeResultHasChanges(mergeResult);

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

      {!hasChanges && !mergeResult.conflicts.length && (
        <Callout status="info">
          There are no changes to publish. Either discard the draft or add
          changes first before publishing.
        </Callout>
      )}

      {mergeResult.success &&
        hasChanges &&
        (experimentsStep ? (
          <div>
            <h3>Review &amp; Publish</h3>
            <p>
              Please review the <strong>Pre-Launch Checklists</strong> for the
              experiments that will be published along with this draft.
            </p>
            {experimentData.map(({ experiment, checklist }) => {
              if (!selectedExperiments.has(experiment.id)) return null;

              return (
                <div key={experiment.id} className="mb-3">
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
                </div>
              );
            })}
          </div>
        ) : (
          <div>
            <h3>Review &amp; Publish</h3>
            <p>
              The changes below will go live when this draft revision is
              published. You will be able to revert later if needed.
            </p>

            {experimentData.length > 0 ? (
              <div className="mb-3">
                <h4>Start running experiments upon publishing:</h4>
                {experimentData.map(({ experiment }) => (
                  <div key={experiment.id}>
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
                  </div>
                ))}
              </div>
            ) : null}

            <h4>Review Diff</h4>
            <div className="list-group mb-4">
              {resultDiffs.map((diff) => (
                <ExpandableDiff {...diff} key={diff.title} />
              ))}
            </div>
            {hasPermission ? (
              <Field
                label="Add a Comment (optional)"
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
          </div>
        ))}
    </Modal>
  );
}
