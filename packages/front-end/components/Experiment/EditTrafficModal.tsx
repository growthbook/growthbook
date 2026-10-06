import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import ExperimentSplitVisual from "@/components/Features/ExperimentSplitVisual";
import VariationSplitTable, {
  SplitValueText,
} from "@/components/Experiment/TabbedPage/SetupPage/VariationSplitTable";
import {
  round1,
  settleTo100,
} from "@/components/Experiment/TabbedPage/SetupPage/splitMath";
import { useAuth } from "@/services/auth";
import { distributeWeights } from "@/services/utils";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import track from "@/services/track";
import MakeChangesFlow from "./MakeChangesFlow";
import { getLinkedExperimentAttributeScopes } from "./useAttributeScopePicker";
import { useExperimentTargetingForm } from "./useExperimentTargetingForm";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures?: LinkedFeatureInfo[];
  mutate: () => void;
  safeToEdit: boolean;
  // Auto-focus this variation's Name field when the modal opens.
  focusVariationId?: string | null;
  // Append a new variation on open and focus its Name field.
  addVariationOnOpen?: boolean;
  // The variations table is read-only (set in review, for the redesigned
  // experiment page): each variation's name and split %, with nothing to
  // edit or act on. Coverage and the split preview work as usual, and Save
  // saves them. focusVariationId and addVariationOnOpen are ignored.
  readOnlyVariations?: boolean;
  // Apply to the caller's draft instead of saving (set in review, for the
  // Setup page): the modal starts from the draft's coverage, variations and
  // split, and its button, "Apply", hands the coverage back; the page's save
  // bar then saves it. Implies readOnlyVariations.
  draft?: TrafficDraft;
}

export interface TrafficDraft {
  coverage: number;
  // In the draft's order, with their weights (fractions) aligned.
  variations: { id: string; name: string }[];
  weights: number[];
  onApply: (coverage: number) => void;
}

export default function EditTrafficModal({
  close,
  experiment,
  linkedFeatures,
  mutate,
  safeToEdit,
  focusVariationId,
  addVariationOnOpen,
  readOnlyVariations = false,
  draft,
}: Props) {
  if (safeToEdit) {
    return (
      <EditTrafficForm
        close={close}
        experiment={experiment}
        mutate={mutate}
        focusVariationId={readOnlyVariations ? null : focusVariationId}
        addVariationOnOpen={readOnlyVariations ? false : addVariationOnOpen}
        readOnlyVariations={readOnlyVariations || !!draft}
        draft={draft}
      />
    );
  }

  return (
    <MakeChanges
      close={close}
      experiment={experiment}
      linkedFeatures={linkedFeatures}
      mutate={mutate}
    />
  );
}

function EditTrafficForm({
  close,
  experiment,
  mutate,
  focusVariationId,
  addVariationOnOpen,
  readOnlyVariations = false,
  draft,
}: {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  focusVariationId?: string | null;
  addVariationOnOpen?: boolean;
  readOnlyVariations?: boolean;
  draft?: TrafficDraft;
}) {
  const { apiCall } = useAuth();
  const isBandit = experiment.type === "multi-armed-bandit";

  const latestPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const form = useForm<
    ExperimentInterfaceStringDates & {
      variationWeights: number[];
      coverage: number;
    }
  >({
    // From the caller's draft when there is one (its unsaved names, order,
    // split and coverage), otherwise from the experiment.
    defaultValues: draft
      ? {
          variations: draft.variations.map((v) => {
            const saved = experiment.variations.find((s) => s.id === v.id);
            return {
              id: v.id,
              key: saved?.key ?? "",
              name: v.name,
              description: saved?.description ?? "",
              screenshots: saved?.screenshots ?? [],
            };
          }),
          variationWeights: draft.weights,
          coverage: draft.coverage,
        }
      : {
          variations: getLatestPhaseVariations(experiment).map((v) => ({
            id: v.id,
            key: v.key,
            name: v.name,
            description: v.description,
            screenshots: v.screenshots,
          })),
          variationWeights:
            latestPhase?.variationWeights ??
            getEqualWeights(experiment.variations.length, 4),
          coverage: latestPhase?.coverage ?? 1,
        },
  });

  const submit = form.handleSubmit(async (value) => {
    // Into the caller's draft; nothing is saved here.
    if (draft) {
      draft.onApply(value.coverage);
      return;
    }
    const originalVariationCount = getLatestPhaseVariations(experiment).length;
    const data = { ...value };
    data.variations = [...value.variations].map((variation, i) => {
      if (!variation.key) variation.key = i + "";
      return variation;
    });

    // fix some common bugs
    if (!isBandit) {
      const newWeights = [
        ...data.variations.map((_, i) =>
          Math.min(
            Math.max(
              data.variationWeights?.[i] ?? 1 / (data.variations?.length || 2),
              0,
            ),
            1,
          ),
        ),
      ];
      data.variationWeights = distributeWeights(newWeights, true);
    } else {
      const latestVariationWeights = latestPhase?.variationWeights ?? [];
      if (
        data.variations.length !== data.variationWeights.length ||
        data.variations.length !== latestVariationWeights.length
      ) {
        // only recompute weights if original weights are the wrong size
        data.variationWeights = getEqualWeights(data.variations.length || 2, 4);
      } else {
        data.variationWeights = [...latestVariationWeights];
      }
    }

    await apiCall(`/experiment/${experiment.id}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    mutate();
    track("edited-traffic");

    const numVariationsAdded = data.variations.length - originalVariationCount;
    if (numVariationsAdded > 0) {
      track("Added Variations", {
        source: "edit-traffic-modal",
        numVariationsAdded,
        totalVariations: data.variations.length,
      });
    }
  });

  // The read-only table's percentages: one decimal place, settled so they
  // add up to exactly 100, as the Edit Split % modal shows them.
  const watchedWeights = form.watch("variationWeights") ?? [];
  const readOnlyPercents = settleTo100(
    watchedWeights.map((w) => round1((w ?? 0) * 100)),
    watchedWeights.map((_, i) => i),
  );

  return (
    <ModalStandard
      trackingEventModalType="edit-traffic-modal"
      open={true}
      close={close}
      header="Edit Traffic & Variations"
      submit={submit}
      cta={draft ? "Apply" : undefined}
      // Apply only once coverage differs from the draft's (set in review),
      // compared as whole percentages, the field's precision.
      ctaEnabled={
        !draft ||
        Math.round((form.watch("coverage") ?? 0) * 100) !==
          Math.round(draft.coverage * 100)
      }
      size="lg"
    >
      <div className="pt-2">
        <FeatureVariationsInput
          label={null}
          valueAsId={isBandit}
          hideSplits={isBandit}
          // Read-only variations: this input keeps only its coverage
          // control (hideVariations, which also drops its own table and
          // split preview); the variations show below in the Edit Split %
          // modal's table, read-only, with the preview after it. Coverage
          // stays editable.
          hideVariations={readOnlyVariations}
          // Also drops "Switch to advanced mode" above it (set in review),
          // which hideVariations leaves. Coverage isn't affected.
          disableVariations={readOnlyVariations}
          coverage={form.watch("coverage")}
          setCoverage={(coverage) => form.setValue("coverage", coverage)}
          setWeight={(i, weight) =>
            form.setValue(`variationWeights.${i}`, weight)
          }
          variations={
            form.watch("variations")?.map((v, i) => ({
              value: v.key || "",
              name: v.name,
              description: v.description,
              screenshots: v.screenshots,
              weight: form.watch(`variationWeights.${i}`),
              id: v.id,
            })) ?? []
          }
          setVariations={(v) => {
            form.setValue(
              "variations",
              v.map((data) => {
                const { value, ...newData } = data;
                return {
                  name: "",
                  description: "",
                  screenshots: [],
                  ...newData,
                  key: value,
                };
              }),
            );
            form.setValue(
              `variationWeights`,
              v.map((v) => v.weight),
            );
          }}
          showPreview
          showDescriptions
          autoFocusVariationId={focusVariationId}
          autoAddVariationOnMount={addVariationOnOpen}
        />
        {readOnlyVariations ? (
          <>
            {/* Each variation's name and split %, nothing to edit or act on
              (set in review), in the Edit Split % modal's table (rows,
              header, number dots, alignment). Percentages as that modal
              shows them: one decimal place, adding up to exactly 100. */}
            <VariationSplitTable
              variations={(form.watch("variations") ?? []).map((v) => ({
                id: v.id,
                name: v.name,
              }))}
              renderSplit={(v, i) => (
                <SplitValueText>{`${readOnlyPercents[i] ?? 0}%`}</SplitValueText>
              )}
            />
            {/* The split preview, as the input draws it under its own
              table. LEGACY: its .box container is the input's. */}
            <div className="box pt-3 px-3 mt-3">
              <ExperimentSplitVisual
                coverage={form.watch("coverage") ?? 0}
                values={(form.watch("variations") ?? []).map((v, i) => ({
                  value: v.key || "",
                  name: v.name,
                  weight: form.watch(`variationWeights.${i}`) ?? 0,
                }))}
                type="string"
              />
            </div>
          </>
        ) : null}
      </div>
    </ModalStandard>
  );
}

function MakeChanges({
  close,
  experiment,
  linkedFeatures,
  mutate,
}: {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures?: LinkedFeatureInfo[];
  mutate: () => void;
}) {
  const { enforcement, dropdown } = getLinkedExperimentAttributeScopes(
    experiment.project,
    linkedFeatures,
  );
  const {
    form,
    defaultValues,
    conditionKey,
    setPrerequisiteTargetingSdkIssues,
    canSubmit,
    onSubmit,
  } = useExperimentTargetingForm(experiment, enforcement);

  return (
    <MakeChangesFlow
      experiment={experiment}
      attributeProjects={dropdown}
      form={form}
      defaultValues={defaultValues}
      onSubmit={(scope) => onSubmit(mutate, scope)()}
      close={close}
      canSubmit={canSubmit}
      conditionKey={conditionKey}
      setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
    />
  );
}
