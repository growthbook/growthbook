import { FeatureInterface } from "shared/types/feature";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import { useState, useMemo } from "react";
import { FaAngleDown, FaAngleRight, FaCheck } from "react-icons/fa";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  MergeConflict,
  MergeStrategy,
  autoMerge,
  mergeResultHasChanges,
  filterEnvironmentsByFeature,
} from "shared/util";
import clsx from "clsx";
import { useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import {
  useFeatureRevisionDiff,
  featureToFeatureRevisionDiffInput,
} from "@/hooks/useFeatureRevisionDiff";
import { ExpandableDiff } from "./DraftModal";

export interface Props {
  feature: FeatureInterface;
  version: number;
  revisions: FeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
}

export function ExpandableConflict({
  conflict,
  strategy,
  setStrategy,
}: {
  conflict: MergeConflict;
  strategy: MergeStrategy;
  setStrategy: (strategy: MergeStrategy) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="appbox mb-4">
      <div className="d-flex align-items-center bg-light px-3 py-2 border-bottom">
        {strategy && (
          <div className="mr-2">
            <FaCheck className="text-success" />
          </div>
        )}
        <h3 className="mb-0">{conflict.name}</h3>
        <div className="ml-4">Pick one:</div>
        <div className="btn-group ml-2">
          <button
            type="button"
            className={clsx("btn", {
              "btn-primary btn-active": strategy === "discard",
              "btn-outline-primary": strategy !== "discard",
            })}
            onClick={(e) => {
              e.preventDefault();
              setStrategy("discard");
              setOpen(false);
            }}
          >
            Keep External Change
          </button>
          <button
            type="button"
            className={clsx("btn", {
              "btn-primary btn-active": strategy === "overwrite",
              "btn-outline-primary": strategy !== "overwrite",
            })}
            onClick={(e) => {
              e.preventDefault();
              setStrategy("overwrite");
              setOpen(false);
            }}
          >
            Keep Your Change
          </button>
        </div>
        <div className="ml-auto">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setOpen(!open);
            }}
          >
            {open ? "Hide" : "Show"} Full Diff{" "}
            {open ? <FaAngleDown /> : <FaAngleRight />}
          </a>
        </div>
      </div>
      {open && (
        <div className="diff-wrapper px-3">
          <div className="row">
            <div className="col border-right pt-2 pb-3">
              <div className="my-2 d-flex">
                <h4 className="mb-0">External Change</h4>
                <div className="ml-3">The change that is currently live</div>
              </div>
              <ReactDiffViewer
                oldValue={conflict.base}
                newValue={conflict.live}
                compareMethod={DiffMethod.LINES}
                styles={{
                  contentText: {
                    wordBreak: "break-all",
                  },
                }}
              />
            </div>
            <div className="col pt-2 pb-3">
              <div className="my-2 d-flex">
                <h4 className="mb-0">Your Change</h4>
                <div className="ml-3">The change in this draft</div>
              </div>
              <ReactDiffViewer
                oldValue={conflict.base}
                newValue={conflict.revision}
                compareMethod={DiffMethod.LINES}
                styles={{
                  contentText: {
                    wordBreak: "break-all",
                  },
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FixConflictsModal({
  feature,
  version,
  revisions,
  close,
  mutate,
}: Props) {
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);

  const { apiCall } = useAuth();

  const [strategies, setStrategies] = useState<Record<string, MergeStrategy>>(
    {},
  );
  const [step, setStep] = useState(0);

  const revision = revisions.find((r) => r.version === version);
  const baseRevision = revisions.find(
    (r) => r.version === revision?.baseVersion,
  );
  const liveRevision = revisions.find((r) => r.version === feature.version);

  const mergeResult = useMemo(() => {
    if (!revision || !baseRevision || !liveRevision) return null;
    return autoMerge(
      liveRevision,
      baseRevision,
      revision,
      environments.map((e) => e.id),
      strategies,
    );
  }, [revision, baseRevision, liveRevision, environments, strategies]);

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

  if (!revision || !mergeResult || !mergeResult.conflicts.length) return null;

  const hasChanges = mergeResultHasChanges(mergeResult);

  return (
    <PagedModal
      trackingEventModalType="resolve-conflicts"
      header={"Resolve Conflicts"}
      step={step}
      setStep={setStep}
      submit={async () => {
        try {
          await apiCall(`/feature/${feature.id}/${revision.version}/rebase`, {
            method: "POST",
            body: JSON.stringify({
              mergeResultSerialized: JSON.stringify(mergeResult),
              strategies,
            }),
          });
        } catch (e) {
          await mutate();
          throw e;
        }
        await mutate();
      }}
      cta={step === 1 ? "Update Draft" : "Next"}
      ctaEnabled={!!mergeResult.success}
      close={close}
      closeCta="Cancel"
      size="max"
    >
      <Page
        display="Fix Conflicts"
        enabled
        validate={async () => {
          if (!mergeResult?.success) {
            throw new Error("Please resolve all conflicts first");
          }
        }}
      >
        <div className="alert alert-danger">
          Conflicting changes have been published since you created this draft.
          Review the conflicts below and decide how you want to proceed.
        </div>
        {mergeResult.conflicts.map((conflict) => (
          <ExpandableConflict
            conflict={conflict}
            key={conflict.name}
            strategy={strategies[conflict.key] || ""}
            setStrategy={(strategy) => {
              setStrategies({
                ...strategies,
                [conflict.key]: strategy,
              });
            }}
          />
        ))}
      </Page>

      <Page display="Review Changes">
        <h3>Merge Result</h3>
        {hasChanges ? (
          <>
            <p>
              Below is the final result of the merge. These are the changes that
              will go live when you publish your draft. Please review them.
            </p>
            <div className="list-group mb-4">
              {resultDiffs.map((diff) => (
                <ExpandableDiff {...diff} key={diff.title} />
              ))}
            </div>
          </>
        ) : (
          <p>Your draft and the live version are identical.</p>
        )}
      </Page>
    </PagedModal>
  );
}
