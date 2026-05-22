import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowRight } from "react-icons/pi";
import {
  GrowthBookClipboardReferenceContext,
  GrowthBookClipboardPayload,
} from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Modal from "@/ui/Modal";
import ModalForm from "@/ui/Modal/ModalForm";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import { useEnvironments, useFeaturesList } from "@/services/features";
import {
  applyFeatureReferenceMappings,
  EMPTY_FEATURE_REFERENCE_MAPPINGS,
  FeatureReferenceCategory,
  FeatureReferenceMappings,
} from "@/services/feature-configuration-clipboard";

type CategoryDescriptor = {
  category: FeatureReferenceCategory;
  title: string;
  emptyMessage: string;
};

// Safe rollouts are intentionally NOT user-mappable: they're per-feature, so
// pointing an imported rule at a destination safe rollout that belongs to a
// different feature would be incoherent. The backend creates fresh
// SafeRollouts during import using the source settings carried in the
// envelope and rewrites rule.safeRolloutId.
const CATEGORIES: CategoryDescriptor[] = [
  {
    category: "experiments",
    title: "Experiments",
    emptyMessage:
      "No experiments in this organization. Mapping not available — these rules will be created with their original (broken) reference.",
  },
  {
    category: "savedGroups",
    title: "Saved Groups",
    emptyMessage:
      "No saved groups in this organization. Mapping not available — these references will be left as-is.",
  },
  {
    category: "features",
    title: "Prerequisite Features",
    emptyMessage:
      "No other features in this organization. Mapping not available — these prerequisites will be left as-is.",
  },
  {
    category: "environments",
    title: "Environments",
    emptyMessage:
      "No environments configured in this organization. Mapping not available — env-scoped rules will keep their source ids.",
  },
];

type Option = { label: string; value: string };

// Returns the references manifest grouped by category. The manifest is the
// source of truth for which references to show — it's produced by the
// exporter, which knows which ids each rule referenced and enriches them with
// source-org names + details.
function buildReferenceRows(
  payload: GrowthBookClipboardPayload,
): Record<FeatureReferenceCategory, GrowthBookClipboardReferenceContext[]> {
  return {
    experiments: payload.references.experiments,
    savedGroups: payload.references.savedGroups,
    // safeRollouts intentionally excluded — backend auto-creates these,
    // they don't need (and can't sensibly receive) user mapping.
    safeRollouts: [],
    features: payload.references.features,
    environments: payload.references.environments,
  };
}

export default function FeatureConfigurationReferenceMappingModal({
  payload,
  close,
  onConfirm,
}: {
  payload: GrowthBookClipboardPayload;
  close: () => void;
  onConfirm: (mappedPayload: GrowthBookClipboardPayload) => void;
}) {
  const rowsByCategory = useMemo(() => buildReferenceRows(payload), [payload]);

  const totalRefs =
    rowsByCategory.experiments.length +
    rowsByCategory.savedGroups.length +
    rowsByCategory.safeRollouts.length +
    rowsByCategory.features.length +
    rowsByCategory.environments.length;

  const { experiments, loading: experimentsLoading } = useExperiments(
    undefined,
    /* includeArchived */ true,
  );
  const { savedGroups } = useDefinitions();
  const { features, loading: featuresLoading } = useFeaturesList({
    useCurrentProject: false,
    includeArchived: true,
  });
  const destinationEnvironments = useEnvironments();

  // We need to wait for every async source before we can pre-populate
  // identity mappings or trust `allMapped`. Otherwise during the loading
  // window options.length === 0 for not-yet-loaded categories, which would
  // (a) make Continue look ready and (b) cause it to flip to disabled once
  // data arrives — and the user's auto-populated rows would be missing.
  const loading = experimentsLoading || featuresLoading;

  const optionsByCategory: Record<FeatureReferenceCategory, Option[]> = useMemo(
    () => ({
      experiments: experiments.map(
        (e: ExperimentInterfaceStringDates): Option => ({
          label: e.name ? `${e.name} (${e.id})` : e.id,
          value: e.id,
        }),
      ),
      savedGroups: savedGroups.map(
        (sg): Option => ({
          label: sg.groupName ? `${sg.groupName} (${sg.id})` : sg.id,
          value: sg.id,
        }),
      ),
      // No options — backend auto-creates SafeRollouts; rows for this
      // category are always empty (see buildReferenceRows).
      safeRollouts: [],
      features: (features ?? []).map(
        (f: FeatureInterface): Option => ({
          label: f.description ? `${f.id} — ${f.description}` : f.id,
          value: f.id,
        }),
      ),
      environments: destinationEnvironments.map(
        (env): Option => ({
          label: env.description ? `${env.id} — ${env.description}` : env.id,
          value: env.id,
        }),
      ),
    }),
    [experiments, savedGroups, features, destinationEnvironments],
  );

  // Mappings start empty and get pre-populated once the async option sources
  // settle (see useEffect below). Pre-population identifies any reference id
  // that exists verbatim in the destination org and seeds it as a default
  // selection the user can confirm or override.
  const [mappings, setMappings] = useState<FeatureReferenceMappings>(() => ({
    experiments: { ...EMPTY_FEATURE_REFERENCE_MAPPINGS.experiments },
    savedGroups: { ...EMPTY_FEATURE_REFERENCE_MAPPINGS.savedGroups },
    safeRollouts: { ...EMPTY_FEATURE_REFERENCE_MAPPINGS.safeRollouts },
    features: { ...EMPTY_FEATURE_REFERENCE_MAPPINGS.features },
    environments: { ...EMPTY_FEATURE_REFERENCE_MAPPINGS.environments },
  }));

  const prepopulatedRef = useRef(false);
  // If the user pastes a second envelope while the modal is still mounted,
  // `payload` swaps under us. Clear the prepop guard and any selections from
  // the previous payload so the prepop effect below re-runs against the new
  // reference rows instead of leaving stale mappings pointing at ids the
  // new payload doesn't contain.
  useEffect(() => {
    prepopulatedRef.current = false;
    setMappings({
      experiments: { ...EMPTY_FEATURE_REFERENCE_MAPPINGS.experiments },
      savedGroups: { ...EMPTY_FEATURE_REFERENCE_MAPPINGS.savedGroups },
      safeRollouts: { ...EMPTY_FEATURE_REFERENCE_MAPPINGS.safeRollouts },
      features: { ...EMPTY_FEATURE_REFERENCE_MAPPINGS.features },
      environments: { ...EMPTY_FEATURE_REFERENCE_MAPPINGS.environments },
    });
  }, [payload]);

  useEffect(() => {
    if (loading || prepopulatedRef.current) return;
    prepopulatedRef.current = true;
    setMappings((prev) => {
      const next: FeatureReferenceMappings = {
        experiments: { ...prev.experiments },
        savedGroups: { ...prev.savedGroups },
        safeRollouts: { ...prev.safeRollouts },
        features: { ...prev.features },
        environments: { ...prev.environments },
      };
      // Name-fallback lookups for the categories where the entity has a real
      // human-readable name distinct from its id. Only seed from name when
      // exactly one destination shares that name — ambiguous matches are left
      // for the user to disambiguate.
      const nameToIds: Partial<
        Record<FeatureReferenceCategory, Map<string, string[]>>
      > = {};
      const addName = (
        category: FeatureReferenceCategory,
        name: string | undefined,
        id: string,
      ) => {
        if (!name) return;
        const key = name.trim().toLowerCase();
        if (!key) return;
        const map = nameToIds[category] ?? new Map<string, string[]>();
        const ids = map.get(key) ?? [];
        ids.push(id);
        map.set(key, ids);
        nameToIds[category] = map;
      };
      experiments.forEach((e: ExperimentInterfaceStringDates) =>
        addName("experiments", e.name, e.id),
      );
      savedGroups.forEach((sg) => addName("savedGroups", sg.groupName, sg.id));

      (Object.keys(rowsByCategory) as FeatureReferenceCategory[]).forEach(
        (category) => {
          const validIds = new Set(
            optionsByCategory[category].map((o) => o.value),
          );
          const byName = nameToIds[category];
          rowsByCategory[category].forEach((row) => {
            // Don't clobber a value the user already touched.
            if (next[category][row.id]) return;
            if (validIds.has(row.id)) {
              next[category][row.id] = row.id;
              return;
            }
            if (byName && row.name) {
              const candidates = byName.get(row.name.trim().toLowerCase());
              if (candidates && candidates.length === 1) {
                next[category][row.id] = candidates[0];
              }
            }
          });
        },
      );
      return next;
    });
  }, [loading, rowsByCategory, optionsByCategory, experiments, savedGroups]);

  // Defensive: parent should have skipped opening this modal when there are
  // no references. Auto-confirm in an effect so we don't set state on the
  // parent during this component's render.
  useEffect(() => {
    if (totalRefs === 0) onConfirm(payload);
  }, [totalRefs, onConfirm, payload]);

  // The form is complete once every row in every category with available
  // options has a mapping. We require !loading so a category whose options
  // haven't arrived yet doesn't masquerade as "no options, skip".
  const allMapped =
    !loading &&
    (Object.keys(rowsByCategory) as FeatureReferenceCategory[]).every(
      (category) => {
        const options = optionsByCategory[category];
        if (!options.length) return true;
        return rowsByCategory[category].every(
          (row) => !!mappings[category][row.id],
        );
      },
    );

  if (totalRefs === 0) return null;

  return (
    <Modal.Root
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      size="lg"
      trackingEventModalType="feature-import-reference-mapping"
    >
      <ModalForm
        onSubmit={() => {
          // Advance the state machine manually here. We deliberately avoid
          // ModalStandard (which would call `close()` on submit success) —
          // `close` is wired to clear the import payload, which would race
          // the `onConfirm` update and drop us out of the flow with no UI.
          const mappedFeature = applyFeatureReferenceMappings(
            payload.feature,
            mappings,
          );
          onConfirm({ ...payload, feature: mappedFeature });
        }}
      >
        <Modal.Header>
          <Modal.Title>Map References Before Importing</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Callout status="info" mb="3">
            This feature was exported from another GrowthBook instance and
            references objects that may not exist here. Pick the matching
            experiment, saved group, safe rollout, or feature in this
            organization for each reference below.
          </Callout>

          {loading && (
            <Callout status="info" mb="3">
              Loading destination options…
            </Callout>
          )}

          {CATEGORIES.map((cat) => {
            const rows = rowsByCategory[cat.category];
            if (!rows.length) return null;
            const options = optionsByCategory[cat.category];
            return (
              <Box key={cat.category} mb="4">
                <Text size="large" weight="semibold">
                  {cat.title}
                </Text>
                {loading ? null : options.length === 0 ? (
                  <Callout status="warning" mt="2">
                    {cat.emptyMessage}
                  </Callout>
                ) : (
                  <Box mt="2">
                    {rows.map((row) => (
                      <Flex
                        key={row.id}
                        align="center"
                        gap="3"
                        mb="3"
                        style={{ width: "100%" }}
                      >
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text weight="medium" as="div">
                            {row.name || row.id}
                          </Text>
                          <Text size="small" as="div" color="text-low">
                            {row.id}
                          </Text>
                          {row.details && (
                            <Text size="small" as="div" color="text-low">
                              {row.details}
                            </Text>
                          )}
                        </Box>
                        <Box style={{ flexShrink: 0 }}>
                          <PiArrowRight size={18} />
                        </Box>
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <SelectField
                            value={mappings[cat.category][row.id] ?? ""}
                            options={options}
                            placeholder={`Select a ${cat.title.toLowerCase().slice(0, -1)}...`}
                            onChange={(value) => {
                              setMappings((prev) => ({
                                ...prev,
                                [cat.category]: {
                                  ...prev[cat.category],
                                  [row.id]: value,
                                },
                              }));
                            }}
                            sort
                          />
                        </Box>
                      </Flex>
                    ))}
                  </Box>
                )}
              </Box>
            );
          })}
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          </Modal.Close>
          <Button type="submit" disabled={!allMapped}>
            Continue
          </Button>
        </Modal.Footer>
      </ModalForm>
    </Modal.Root>
  );
}

// Helper used by the parent to decide whether to render the modal at all.
// Returns true if the payload's references manifest contains at least one
// USER-MAPPABLE cross-org reference. Safe rollouts are intentionally
// excluded — the backend auto-creates them — so a payload whose only refs
// are safe rollouts skips straight to the FeatureModal.
export function payloadHasReferences(
  payload: GrowthBookClipboardPayload,
): boolean {
  const r = payload.references;
  return (
    r.experiments.length > 0 ||
    r.savedGroups.length > 0 ||
    r.features.length > 0 ||
    r.environments.length > 0
  );
}
