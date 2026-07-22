import { useMemo, useState } from "react";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { useForm } from "react-hook-form";
import { Text } from "@radix-ui/themes";
import { getReviewSetting } from "shared/util";
import { useAuth } from "@/services/auth";
import { useExperiments } from "@/hooks/useExperiments";
import Callout from "@/ui/Callout";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import { HoldoutSelect } from "@/components/Holdout/HoldoutSelect";
import { useFeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";

const AddToHoldoutModal = ({
  feature,
  revisionList,
  close,
  mutate,
  setVersion,
}: {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  setVersion: (version: number) => void;
}) => {
  const form = useForm({
    defaultValues: {
      holdout: feature.holdout?.id ? feature.holdout : undefined,
    },
  });

  const { apiCall } = useAuth();
  const { experimentsMap } = useExperiments();

  const settings = useOrgSettings();
  const gatedEnvSet: Set<string> | "all" | "none" = useMemo(() => {
    const raw = settings?.requireReviews;
    if (raw === true) return "all";
    if (!Array.isArray(raw)) return "none";
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return "none";
    const envList = reviewSetting.environments ?? [];
    return envList.length === 0 ? "all" : new Set(envList);
  }, [settings?.requireReviews, feature]);

  const defaultDraft = useDefaultDraft(revisionList);
  const [mode, setMode] = useState<DraftMode>(
    defaultDraft !== null ? "existing" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  const revisionsCtx = useFeatureRevisionsContext();

  // The rules the publish will actually evaluate depending on the draft
  // selected in the modal.
  const effectiveRules = useMemo(() => {
    if (mode === "existing" && selectedDraft !== null) {
      const draftRevision = revisionsCtx?.revisions.find(
        (r) => r.version === selectedDraft,
      );
      if (draftRevision) return draftRevision.rules ?? [];
    }
    // Fall back to the live rules if no existing draft is selected.
    return revisionsCtx?.baseFeature.rules ?? feature.rules ?? [];
  }, [mode, selectedDraft, revisionsCtx, feature.rules]);

  const selectedHoldoutId = form.watch("holdout")?.id ?? null;

  // Categorize what would block the holdout so the warning can name each one.
  // Deleted experiments (absent from experimentsMap) don't block — they're gone.
  const holdoutBlockers = useMemo(() => {
    const nonDraftExperiments: {
      id: string;
      name: string;
      status: string;
    }[] = [];
    const banditExperiments: { id: string; name: string }[] = [];

    effectiveRules
      .filter((rule) => rule.type === "experiment-ref")
      .forEach((rule) => {
        const exp = experimentsMap.get(rule.experimentId);
        if (!exp) return;
        if (exp.type === "multi-armed-bandit") {
          banditExperiments.push({ id: exp.id, name: exp.name });
        }
        if (exp.status !== "draft") {
          nonDraftExperiments.push({
            id: exp.id,
            name: exp.name,
            status: exp.status,
          });
        }
      });

    const hasSafeRollout = effectiveRules.some(
      (rule) => rule.type === "safe-rollout",
    );

    return {
      nonDraftExperiments,
      banditExperiments,
      hasSafeRollout,
    };
  }, [effectiveRules, experimentsMap]);

  // Experiments already tied to a different holdout than the one selected in
  // this modal. This doesn't hide the selector — it just blocks submitting
  // until the user picks the holdout those experiments already belong to.
  const conflictingHoldoutExperiments = useMemo(() => {
    const conflicts: { id: string; name: string }[] = [];
    effectiveRules
      .filter((rule) => rule.type === "experiment-ref")
      .forEach((rule) => {
        const exp = experimentsMap.get(rule.experimentId);
        if (!exp) return;
        if (exp.holdoutId && exp.holdoutId !== selectedHoldoutId) {
          conflicts.push({ id: exp.id, name: exp.name });
        }
      });
    return conflicts;
  }, [effectiveRules, experimentsMap, selectedHoldoutId]);

  const hasBlockers =
    holdoutBlockers.nonDraftExperiments.length > 0 ||
    holdoutBlockers.banditExperiments.length > 0 ||
    holdoutBlockers.hasSafeRollout;

  const showHoldoutSelect = !hasBlockers;
  const canSubmit =
    showHoldoutSelect && conflictingHoldoutExperiments.length === 0;

  return (
    <ModalStandard
      header="Add to holdout"
      close={close}
      open={true}
      trackingEventModalType="add-feature-to-holdout"
      size="lg"
      ctaEnabled={canSubmit}
      submit={form.handleSubmit(async (value) => {
        const isPublish = mode === "publish";
        const res = await apiCall<{
          feature: FeatureInterface;
          draftVersion?: number;
        }>(`/feature/${feature.id}`, {
          method: "PUT",
          body: JSON.stringify({
            ...value,
            ...(isPublish
              ? { autoPublish: true }
              : mode === "existing" && selectedDraft !== null
                ? { targetDraftVersion: selectedDraft }
                : { forceNewDraft: true }),
          }),
        });

        await mutate();
        const resolvedVersion =
          res.draftVersion ?? (mode === "existing" ? selectedDraft : null);
        if (resolvedVersion !== null) setVersion(resolvedVersion);
      })}
    >
      <DraftSelectorForChanges
        feature={feature}
        revisionList={revisionList}
        mode={mode}
        setMode={setMode}
        selectedDraft={selectedDraft}
        setSelectedDraft={setSelectedDraft}
        canAutoPublish={false}
        gatedEnvSet={gatedEnvSet}
      />

      {hasBlockers && (
        <Callout status="error" mt="3">
          <Text as="div">
            A holdout can&apos;t be added to{" "}
            {mode === "existing" ? "this draft" : "this Feature Flag"} until the
            following are resolved:
          </Text>
          <ul style={{ marginBottom: 0 }}>
            {holdoutBlockers.nonDraftExperiments.map((exp) => (
              <li key={`status-${exp.id}`}>
                Experiment &ldquo;{exp.name}&rdquo; is {exp.status}. You
                can&apos;t add a holdout in front of a non-draft experiment.
              </li>
            ))}
            {holdoutBlockers.banditExperiments.map((exp) => (
              <li key={`bandit-${exp.id}`}>
                &ldquo;{exp.name}&rdquo; is a Bandit, which can&apos;t run under
                a holdout.
              </li>
            ))}
            {holdoutBlockers.hasSafeRollout && (
              <li>Remove the safe rollout rule before adding a holdout.</li>
            )}
          </ul>
        </Callout>
      )}

      {showHoldoutSelect && (
        <>
          <HoldoutSelect
            selectedProject={feature.project}
            setHoldout={(holdoutId) => {
              form.setValue("holdout", {
                id: holdoutId,
                value: feature.defaultValue,
              });
            }}
            selectedHoldoutId={selectedHoldoutId ?? undefined}
            formType="feature"
          />

          {conflictingHoldoutExperiments.length > 0 && (
            <Callout status="error" mt="3">
              <Text as="div">
                The selected holdout doesn&apos;t match the holdout these
                experiments already belong to. Select their holdout to continue:
              </Text>
              <ul style={{ marginBottom: 0 }}>
                {conflictingHoldoutExperiments.map((exp) => (
                  <li key={`holdout-${exp.id}`}>
                    Experiment &ldquo;{exp.name}&rdquo; belongs to a different
                    holdout.
                  </li>
                ))}
              </ul>
            </Callout>
          )}
        </>
      )}
    </ModalStandard>
  );
};

export default AddToHoldoutModal;
