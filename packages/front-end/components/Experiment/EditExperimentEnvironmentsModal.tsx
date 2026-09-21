import { useMemo, useState } from "react";
import { Box } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import {
  filterEnvironmentsByExperiment,
  getReviewSetting,
  isManagedByExperiment,
  naiveFlattenV1Rules,
} from "shared/util";
import { ExperimentRefRule } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RuleEnvironmentScopeField from "@/components/Features/RuleModal/EnvironmentScopeField";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";
import DraftSelectorDropdown, {
  DraftMode,
} from "@/components/Features/DraftSelectorDropdown";
import LinkedFeatureLabel from "@/components/Experiment/LinkedFeatureLabel";

// Saving stages the re-scope on the flag's draft; nothing serves until publish.
export default function EditExperimentEnvironmentsModal({
  experiment,
  info,
  close,
  mutate,
}: {
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  close: () => void;
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();

  // A managed flag has exactly one draft; any other may have several.
  const isManaged = isManagedByExperiment(info.feature, experiment.id);
  const { data: revisionData } = useApi<{
    revisionList: MinimalFeatureRevisionInterface[];
    revisions: FeatureRevisionInterface[];
  }>(`/feature/${info.feature.id}`, { shouldRun: () => !isManaged });

  // Mirrors the back end: only a draft already carrying this rule can be re-scoped.
  const eligibleDraftVersions = useMemo(() => {
    const set = new Set<number>();
    for (const r of revisionData?.revisions ?? []) {
      const hasRefRule = naiveFlattenV1Rules(r.rules).some(
        (rule) =>
          rule.type === "experiment-ref" &&
          (rule as ExperimentRefRule).experimentId === experiment.id,
      );
      if (hasRefRule) set.add(r.version);
    }
    if (info.pendingDraft) set.add(info.pendingDraft.version);
    return set;
  }, [revisionData, experiment.id, info.pendingDraft]);

  const gatedEnvSet: Set<string> | "all" | "none" = useMemo(() => {
    const raw = settings?.requireReviews;
    if (raw === true) return "all";
    if (!Array.isArray(raw)) return "none";
    const reviewSetting = getReviewSetting(raw, info.feature);
    if (!reviewSetting?.requireReviewOn) return "none";
    const envList = reviewSetting.environments ?? [];
    return envList.length === 0 ? "all" : new Set(envList);
  }, [settings?.requireReviews, info.feature]);

  const [mode, setMode] = useState<DraftMode>(
    info.pendingDraft ? "existing" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    info.pendingDraft?.version ?? null,
  );
  const environments = filterEnvironmentsByExperiment(
    useEnvironments(),
    experiment,
  );

  // "missing" is the only state meaning the rule doesn't cover the environment.
  const scoped = Object.entries(
    info.pendingDraft?.environmentStates ?? info.environmentStates ?? {},
  )
    .filter(([, state]) => state !== "missing")
    .map(([env]) => env);
  const coversAll = environments.every((e) => scoped.includes(e.id));

  const [allEnvironments, setAllEnvironments] = useState(coversAll);
  const [selectedEnvironments, setSelectedEnvironments] =
    useState<string[]>(scoped);

  return (
    <ModalStandard
      trackingEventModalType="edit-experiment-environments"
      trackingEventModalSource="traffic-allocation"
      header="Edit Environments"
      headerAction={
        isManaged ? undefined : (
          <DraftSelectorDropdown
            feature={info.feature}
            revisionList={revisionData?.revisionList ?? []}
            mode={mode}
            setMode={setMode}
            selectedDraft={selectedDraft}
            setSelectedDraft={setSelectedDraft}
            canAutoPublish={false}
            gatedEnvSet={gatedEnvSet}
            eligibleDraftVersions={eligibleDraftVersions}
          />
        )
      }
      open={true}
      close={close}
      cta="Save"
      ctaEnabled={allEnvironments || selectedEnvironments.length > 0}
      submit={async () => {
        await apiCall(
          `/experiment/${experiment.id}/linked-feature/${info.feature.id}/environments`,
          {
            method: "POST",
            body: JSON.stringify({
              allEnvironments,
              environments: allEnvironments ? [] : selectedEnvironments,
              // Managed flags keep their one draft; otherwise honour the picker.
              ...(isManaged || mode !== "existing" || selectedDraft === null
                ? {}
                : { targetVersion: selectedDraft }),
            }),
          },
        );
        mutate();
      }}
    >
      {isManaged ? null : (
        <Box mb="4">
          <LinkedFeatureLabel featureId={info.feature.id} />
        </Box>
      )}
      <RuleEnvironmentScopeField
        environments={environments}
        allEnvironments={allEnvironments}
        setAllEnvironments={setAllEnvironments}
        selectedEnvironments={selectedEnvironments}
        setSelectedEnvironments={setSelectedEnvironments}
        label="Environments"
      />
    </ModalStandard>
  );
}
