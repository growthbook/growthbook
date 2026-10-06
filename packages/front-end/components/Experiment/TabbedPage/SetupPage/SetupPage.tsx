import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { experimentHasLiveLinkedChanges } from "shared/util";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { generateVariationId } from "@/services/features";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Markdown from "@/components/Markdown/Markdown";
import LinkedChanges from "@/components/Experiment/LinkedChanges/LinkedChanges";
import EditVariationMetadataModal from "@/components/Experiment/EditVariationMetadataModal";
import CustomFieldDisplay from "@/components/CustomFields/CustomFieldDisplay";
import TrafficAllocationFunnel from "@/components/Experiment/TabbedPage/TrafficAllocationFunnel";
import EditTrafficModal from "@/components/Experiment/EditTrafficModal";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { useDismissToasts, useToast } from "@/ui/Toast";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import {
  ManagedValueDataType,
  useExperimentType,
  useManagedValues,
} from "@/components/Experiment/TabbedPage/ManagedValuesContext";
import ChangeExperimentTypeModal from "@/components/Experiment/TabbedPage/ChangeExperimentTypeModal";
import { getLinkedChangesSummary } from "@/components/Experiment/TabbedPage/linkedChangesSummary";
import useOrgSettings from "@/hooks/useOrgSettings";
import EditScheduleModal from "@/components/Experiment/EditScheduleModal";
import GreyContainer from "./GreyContainer";
import HypothesisField from "./HypothesisField";
import EditValuesEnvironmentsModal from "./EditValuesEnvironmentsModal";
import VariationEditModal from "./VariationEditModal";
import SplitEditModal from "./SplitEditModal";
import { readAiSetupDuration } from "./aiSetupFixture";
import UnsavedChangesGuard from "./UnsavedChangesGuard";
import { EnvironmentsRow, ValueInput, ValuesRowHeader } from "./InlineValues";
import SetupRail from "./SetupRail";
import styles from "./SetupRail.module.scss";
import AnalysisPlan from "./AnalysisPlan";
import { AdvancedAnalysisState } from "./AdvancedAnalysisFields";
import {
  SequentialDefaults,
  SetupDraft,
  StubbedPart,
  buildSavePayload,
  changedFields,
  draftFromExperiment,
  draftWeights,
  pickStubbed,
  rebaseDraft,
} from "./setupDraft";

// The redesigned Setup tab. One page for every amount of setup: an empty
// experiment, a partial one and a fully populated one are the same layout
// with more or fewer fields filled in. There's no separate empty state.
//
// Editing is in place while the experiment is a draft. Every field writes to
// one local draft, and the footer's Save commits it in one request. Once the
// experiment has started, the page is a read-only display.

// How long after a save the save bar may flick on while things settle,
// without that counting as a new change.
const SAVE_SETTLE_MS = 1500;

// Design value for the Hypothesis label gutter.
const HYPOTHESIS_LABEL_PX = 160;

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  disableEditing?: boolean;
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  linkedFeatures: LinkedFeatureInfo[];
  envs: string[];
  visualChangesetEnvStates?: LinkedChangeEnvStates;
  urlRedirectEnvStates?: LinkedChangeEnvStates;
  editTargeting?: (() => void) | null;
  editTraffic?: ((variationId?: string) => void) | null;
  addVariation?: (() => void) | null;
  editNamespace?: (() => void) | null;
  editVariations?: (() => void) | null;
  setFeatureModal: (open: boolean) => void;
  setVisualEditorModal: (open: boolean) => void;
  setUrlRedirectModal: (open: boolean) => void;
  // The right rail is collapsed from the header's toggle.
  railCollapsed?: boolean;
}

function SectionDivider() {
  return (
    <Box
      my="5"
      style={{ borderBottom: "1px solid var(--gray-a5)" }}
      aria-hidden
    />
  );
}

export default function SetupPage({
  experiment,
  mutate,
  disableEditing,
  visualChangesets,
  urlRedirects,
  linkedFeatures,
  envs,
  visualChangesetEnvStates,
  urlRedirectEnvStates,
  editTargeting,
  editTraffic,
  addVariation,
  editNamespace,
  editVariations,
  setFeatureModal,
  setVisualEditorModal,
  setUrlRedirectModal,
  railCollapsed = false,
}: Props) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();

  const canEditExperiment =
    !experiment.archived &&
    permissionsUtil.canViewExperimentModal(experiment.project) &&
    !disableEditing;
  // Inline editing is a draft-only affordance. The Running frame in the
  // design is a read-only display of the same page.
  const editable = canEditExperiment && experiment.status === "draft";
  const scheduleArmed = !!experiment.nextScheduledStatusUpdate;
  // The schedule modal, opened from Timing's Starts pencil.
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);

  // The org's sequential testing defaults: sequential testing's "Default"
  // choice follows them, in how it's seeded and in what Save sends.
  const orgSettings = useOrgSettings();
  const sequentialDefaults: SequentialDefaults = useMemo(
    () => ({
      enabled: !!orgSettings.sequentialTestingEnabled,
      tuningParameter:
        orgSettings.sequentialTestingTuningParameter ??
        DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
    }),
    [
      orgSettings.sequentialTestingEnabled,
      orgSettings.sequentialTestingTuningParameter,
    ],
  );

  // The saved delivery type (prototype; ManagedValuesContext). The draft
  // carries its own, which the rail's Change Experiment Type modal sets and
  // Save applies (set in review).
  const { type: deliveryType } = useExperimentType();

  // The saved baseline: the experiment's backed fields, plus the stubbed
  // fields as of the last save (they have nowhere else to live).
  // A draft created with "Set up with AI" starts from the fixture's duration
  // (prototype only; see aiSetupFixture.ts).
  const [stubBase, setStubBase] = useState<StubbedPart>(() => ({
    ...pickStubbed(draftFromExperiment(experiment, sequentialDefaults)),
    ...readAiSetupDuration(experiment.id),
  }));
  const base = useMemo(
    () => ({
      ...draftFromExperiment(experiment, sequentialDefaults, deliveryType),
      ...stubBase,
    }),
    [experiment, stubBase, sequentialDefaults, deliveryType],
  );
  const [draft, setDraft] = useState<SetupDraft>(base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the baseline moves (after a save, or an edit made in a modal on this
  // page), keep unsaved edits and take the new values everywhere else.
  const prevBase = useRef(base);
  useEffect(() => {
    if (prevBase.current === base) return;
    const oldBase = prevBase.current;
    prevBase.current = base;
    setDraft((prev) => rebaseDraft(oldBase, base, prev));
  }, [base]);

  const update = (patch: Partial<SetupDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  // --- Delivery type (prototype, front-end only) ---------------------------
  //
  // The Values type's payload is edited inline on this page and committed by
  // the same Save as everything else. Editable only on a draft, like the
  // backed fields above: once running, the values and their type are
  // read-only (set in review). It persists to localStorage only (see
  // ManagedValuesContext.tsx).
  const { environments, setType, setVisualEditorUrl } = useExperimentType();
  const { config: managedValues, setConfig: setManagedValues } =
    useManagedValues();
  const isValuesType = deliveryType === "values";
  const valuesEditable = canEditExperiment && experiment.status === "draft";
  const valuesBase = useMemo(
    () => ({
      dataType: (managedValues?.dataType ?? "string") as ManagedValueDataType,
      valuesByVariationId: managedValues?.valuesByVariationId ?? {},
    }),
    [managedValues],
  );
  const [valuesDraft, setValuesDraft] = useState(valuesBase);
  // Reset when the stored values change underneath (a save, or the type
  // modal clearing them on a type change).
  useEffect(() => setValuesDraft(valuesBase), [valuesBase]);
  const valuesDirty =
    isValuesType &&
    (valuesDraft.dataType !== valuesBase.dataType ||
      experiment.variations.some(
        (v) =>
          (valuesDraft.valuesByVariationId[v.id] ?? "") !==
          (valuesBase.valuesByVariationId[v.id] ?? ""),
      ));

  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [environmentsModalOpen, setEnvironmentsModalOpen] = useState(false);

  // The rest of the analysis settings (Advanced), which keep their own form.
  // A ref for the latest payload builder and reset; state for dirtiness, so
  // the footer re-renders.
  const advancedRef = useRef<AdvancedAnalysisState | null>(null);
  const [advancedDirty, setAdvancedDirty] = useState(false);
  const onAdvancedStateChange = useCallback((state: AdvancedAnalysisState) => {
    advancedRef.current = state;
    setAdvancedDirty(state.dirty);
  }, []);

  const dirty =
    changedFields(base, draft).length > 0 || valuesDirty || advancedDirty;

  const toast = useToast();

  // When the last save finished, so the save bar's settling right after it
  // isn't taken for a new change (see the toast clearing below).
  const lastSavedAt = useRef(0);
  // Resolves true when the save worked.
  async function save(): Promise<boolean> {
    setError(null);
    setSaving(true);
    try {
      const advancedPayload: Record<string, unknown> = advancedDirty
        ? (advancedRef.current?.getPayload() ?? {})
        : {};
      const payload = {
        ...buildSavePayload(
          base,
          draft,
          experiment.decisionFrameworkSettings,
          sequentialDefaults,
        ),
        ...advancedPayload,
        ...variationsPayload(advancedPayload),
        // What Edit Data Source cleared for the new data source, last, so
        // the Advanced section's copy can't send the old values back.
        ...(changedFields(base, draft).includes("dataSourceResets")
          ? draft.dataSourceResets
          : {}),
      };
      if (Object.keys(payload).length > 0) {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      // The type from the rail's Change Experiment Type modal (prototype,
      // this browser only): applied as the modal used to, clearing what the
      // old type owned. Values edits are dropped when leaving Values.
      const typeChanged = draft.deliveryType !== base.deliveryType;
      if (typeChanged) {
        if (
          base.deliveryType === "values" ||
          base.deliveryType === "url-redirect"
        ) {
          setManagedValues(null);
        } else if (base.deliveryType === "visual-editor") {
          setVisualEditorUrl("");
        }
        setType(draft.deliveryType);
      }
      if (valuesDirty && !(typeChanged && base.deliveryType === "values")) {
        setManagedValues({
          dataType: valuesDraft.dataType,
          // The key the values are delivered under. Kept if one exists;
          // otherwise the experiment key, which the design shows as the same.
          key: managedValues?.key || experiment.trackingKey,
          valuesByVariationId: valuesDraft.valuesByVariationId,
        });
      }
      // STUBBED fields "save" locally only: they become the new baseline so
      // the page stops reporting them as unsaved, but nothing is persisted.
      // A reload loses them.
      setStubBase(pickStubbed(draft));
      await mutate();
      // A brief confirmation, since the save bar just goes away (set in
      // review).
      toast("Changes saved");
      lastSavedAt.current = Date.now();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save changes.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  // The draft's variations, if reordered or added to, as the Edit Traffic
  // & Variations modal saves them: each variation's whole record moves
  // (name, description, screenshots, id) and its weight with it; keys still
  // at the defaults ("0", "1", ...) are renumbered by position, so the index
  // stays with the position, while custom keys move with their variation.
  // Combined with any Variation IDs edits from Advanced, whose keys win.
  function variationsPayload(
    advancedPayload: Record<string, unknown>,
  ): Record<string, unknown> {
    const changed = changedFields(base, draft);
    // Only the split changed: just the weights, in the saved order.
    if (!changed.includes("variations")) {
      return changed.includes("splitWeights")
        ? { variationWeights: draftWeights(draft) }
        : {};
    }
    const editedKeys = advancedPayload.variations as
      | ExperimentInterfaceStringDates["variations"]
      | undefined;
    const savedById = new Map(
      (editedKeys ?? experiment.variations).map((v) => [v.id, v]),
    );
    const defaultKeys =
      !editedKeys && experiment.variations.every((v, i) => v.key === i + "");
    return {
      variations: draft.variations.map((dv, i) => {
        const saved = savedById.get(dv.id);
        return {
          // A saved variation keeps its key (unless default keys are
          // renumbered) and screenshots; an added one starts with none.
          ...(saved ?? { key: i + "", screenshots: [] }),
          id: dv.id,
          name: dv.name,
          description: dv.description,
          ...(defaultKeys || !saved ? { key: i + "" } : {}),
        };
      }),
      variationWeights: draftWeights(draft),
    };
  }

  // The Implementation section's "+" adds a variation to the draft (set in
  // review): the same new variation the Edit Traffic & Variations modal's
  // Add Variation makes ("Variation n", the next index as its key, a new
  // id). It shows at once, the save bar comes up, and Save commits it (with
  // the modal's weights; see draftVariationWeights). Discard removes it.
  function addVariationInline() {
    const n = draft.variations.length;
    update({
      variations: [
        ...draft.variations,
        { id: generateVariationId(), name: `Variation ${n}`, description: "" },
      ],
    });
  }

  // A variation's own modal (set in review): the pencil on each card opens
  // it, for that variation's name, description and images, and to delete
  // it. Name, description and deleting edit the draft (Apply; Save commits
  // it); images upload straight away, as the uploader does everywhere.
  const [editingVariationId, setEditingVariationId] = useState<string | null>(
    null,
  );
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  // The variation whose split pill opened the Edit Split % modal; its field
  // takes focus there (set in review).
  const [splitFocusId, setSplitFocusId] = useState<string | null>(null);
  // Edit Traffic & Variations, opened from this page on a draft it can edit:
  // applies coverage to the draft (the save bar comes up) instead of saving
  // (set in review). Otherwise the page-level modal, as before.
  const [trafficModalOpen, setTrafficModalOpen] = useState(false);
  const savedVariationIds = new Set(experiment.variations.map((v) => v.id));
  // What the cards show from the draft: the order, unsaved added variations,
  // and edited names and descriptions.
  const draftAddedVariations = draft.variations
    .filter((v) => !savedVariationIds.has(v.id))
    .map((v) => ({ ...v, key: "", screenshots: [] }));
  const draftVariationEdits = Object.fromEntries(
    draft.variations.map((v) => [
      v.id,
      { name: v.name, description: v.description },
    ]),
  );

  function discard() {
    setError(null);
    setDraft(base);
    setValuesDraft(valuesBase);
    advancedRef.current?.reset();
  }

  const [editMetadataIndex, setEditMetadataIndex] = useState<number | null>(
    null,
  );

  const hasVisualEditorPermission =
    canEditExperiment && permissionsUtil.canRunExperiment(experiment, []);
  const canAddLinkedChanges =
    hasVisualEditorPermission &&
    experiment.status === "draft" &&
    !scheduleArmed;
  const hasLinkedChanges =
    experiment.hasVisualChangesets ||
    linkedFeatures.length > 0 ||
    experiment.hasURLRedirects;
  const safeToEdit =
    experiment.status !== "running" ||
    !experimentHasLiveLinkedChanges(experiment, linkedFeatures);

  // Fill at least the rest of the viewport, so on a short page the rail's
  // border still runs to the bottom of the window. Measured rather than a
  // fixed calc(): the header above varies in height (banners, wrapping
  // titles). A ResizeObserver also catches the tab being shown after it was
  // mounted hidden (display: none measures as zero).
  const rootRef = useRef<HTMLDivElement>(null);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => {
      if (!el.offsetParent) return; // hidden: nothing to measure
      const top = el.getBoundingClientRect().top + window.scrollY;
      setMinHeight(Math.max(0, window.innerHeight - top));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  // The save bar's height while it's showing, so the rail can stop above it
  // instead of running under it.
  const footerRef = useRef<HTMLDivElement>(null);
  const [footerHeight, setFooterHeight] = useState(0);
  // The save bar shows as soon as there's an edit to save (set in review;
  // it had waited for the field to lose focus).
  const showFooter = (editable || valuesEditable) && (dirty || !!error);
  // When the save bar comes back for a new change, clear any toast (e.g.
  // "Changes saved" from the last save): it sits over the bar's Save button
  // (set in review). Only on a real return: the bar going from hidden to
  // shown, and not while a save is settling (the reloaded experiment and the
  // Advanced fields' reset can flick it on for a moment, which had cleared
  // the save's own toast straight away).
  const dismissToasts = useDismissToasts();
  const wasShowingFooter = useRef(showFooter);
  useEffect(() => {
    const cameBack = showFooter && !wasShowingFooter.current;
    wasShowingFooter.current = showFooter;
    if (cameBack && Date.now() - lastSavedAt.current > SAVE_SETTLE_MS) {
      dismissToasts();
    }
  }, [showFooter, dismissToasts]);
  useEffect(() => {
    const el = footerRef.current;
    if (!showFooter || !el) {
      setFooterHeight(0);
      return;
    }
    const update = () => setFooterHeight(el.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [showFooter]);

  return (
    // The page, then the save bar under it across the full width.
    <Flex ref={rootRef} direction="column" style={{ minHeight }}>
      <Flex align="stretch" flexGrow="1">
        {typeModalOpen ? (
          <ChangeExperimentTypeModal
            close={() => setTypeModalOpen(false)}
            // Into the draft (set in review); the save bar makes the change.
            current={draft.deliveryType}
            onApply={(type) => update({ deliveryType: type })}
            linkedChangesSummary={getLinkedChangesSummary({
              linkedFeatures,
              visualChangesets,
              urlRedirects,
            })}
          />
        ) : null}
        {/* Leaving with unsaved changes asks first (set in review). */}
        <UnsavedChangesGuard
          active={(editable || valuesEditable) && dirty}
          discard={discard}
        />
        {environmentsModalOpen ? (
          <EditValuesEnvironmentsModal
            close={() => setEnvironmentsModalOpen(false)}
          />
        ) : null}
        {/* The app's schedule modal, as the header's Edit schedule opens
          it: it says when the experiment is scheduled, saves on its own, and
          keeps an approved schedule approved. */}
        {scheduleModalOpen ? (
          <EditScheduleModal
            experiment={experiment}
            mutate={mutate}
            close={() => setScheduleModalOpen(false)}
            redesigned
          />
        ) : null}
        {(() => {
          // The open variation's own modal (see editingVariationId).
          const i = draft.variations.findIndex(
            (v) => v.id === editingVariationId,
          );
          if (i === -1) return null;
          const v = draft.variations[i];
          return (
            <VariationEditModal
              experiment={experiment}
              variation={v}
              index={i}
              canDelete={draft.variations.length > 2}
              onApply={(changes) =>
                update({
                  variations: draft.variations.map((d) =>
                    d.id === v.id ? { ...d, ...changes } : d,
                  ),
                })
              }
              onDelete={() =>
                update({
                  variations: draft.variations.filter((d) => d.id !== v.id),
                })
              }
              close={() => setEditingVariationId(null)}
              mutate={mutate}
            />
          );
        })()}
        {trafficModalOpen ? (
          <EditTrafficModal
            close={() => setTrafficModalOpen(false)}
            experiment={experiment}
            mutate={mutate}
            safeToEdit={safeToEdit}
            draft={{
              coverage: draft.coverage,
              variations: draft.variations,
              weights: draftWeights(draft),
              onApply: (coverage) => update({ coverage }),
            }}
          />
        ) : null}
        {splitModalOpen ? (
          <SplitEditModal
            variations={draft.variations}
            weights={draftWeights(draft)}
            // Into the draft, by id; the save bar comes up (set in review).
            onConfirm={(weights) =>
              update({
                splitWeights: Object.fromEntries(
                  draft.variations.map((v, i) => [v.id, weights[i]]),
                ),
              })
            }
            close={() => setSplitModalOpen(false)}
            focusVariationId={splitFocusId}
          />
        ) : null}
        {editMetadataIndex !== null && canEditExperiment ? (
          <EditVariationMetadataModal
            experiment={experiment}
            variationIndex={editMetadataIndex}
            close={() => setEditMetadataIndex(null)}
            mutate={mutate}
            source="setup-page"
          />
        ) : null}

        {/* 24px below the tab divider. The page wrapper has no top padding on
        this tab, so the rail beside this column can reach the divider.
        24px before the rail's border, set in review. */}
        <Box
          flexGrow="1"
          minWidth="0"
          pt="5"
          pb="5"
          // The line between this column and the rail. Here rather than on the
          // rail, which is pinned and only window-height, so the line still
          // runs the full height of the page. With the rail collapsed there's
          // no line, and the right edge matches the page's 32px left edge.
          // The divider fades and the right padding eases along with the
          // rail's slide (see .railSlide in SetupRail.module.scss).
          className={styles.mainColumn}
          style={{
            paddingRight: railCollapsed ? "var(--space-6)" : "var(--space-5)",
            borderRight: `1px solid ${
              railCollapsed ? "transparent" : "var(--gray-a5)"
            }`,
          }}
        >
          {/* Hypothesis: label gutter on the left, content on the right. */}
          <Box
            style={{
              display: "grid",
              gridTemplateColumns: `${HYPOTHESIS_LABEL_PX}px minmax(0, 1fr)`,
              columnGap: "var(--space-4)",
              alignItems: "start",
            }}
          >
            <Box pt="1">
              <Heading as="h3" size="sm" weight="medium" mb="0">
                Hypothesis
              </Heading>
            </Box>
            {/* 10px narrower, taken from the left so the right edge stays in
              line with the rest of the page, like the Analysis Plan's fields
              (set in review). */}
            <Box minWidth="0" style={{ marginLeft: 10 }}>
              {editable ? (
                <HypothesisField
                  value={draft.hypothesis}
                  onChange={(hypothesis) => update({ hypothesis })}
                />
              ) : (
                // Read-only (e.g. running): the first line lined up with the
                // "Hypothesis" label (fixed in review). This text is set to
                // 14px on a 20px line with 4px above: the 6px that centred
                // it on paper, less 2px that looked right on screen (set in
                // review).
                <Box
                  style={{
                    paddingTop: 4,
                    fontSize: "var(--font-size-2)",
                    lineHeight: "var(--line-height-2)",
                  }}
                >
                  {draft.hypothesis ? (
                    <Markdown>{draft.hypothesis}</Markdown>
                  ) : (
                    // "None", as the read-only metrics show it, in the page
                    // text colour (set in review; was a muted em dash).
                    <Text>None</Text>
                  )}
                </Box>
              )}
            </Box>
          </Box>

          <SectionDivider />

          {/* Implementation: stacked, one full-width grey container. The id
          is the To Do list's jump target. */}
          <Box id="setup-implementation" style={{ scrollMarginTop: 120 }}>
            <Heading as="h3" size="sm" weight="medium" mb="3">
              Implementation
            </Heading>
          </Box>
          <GreyContainer px="4" py="5">
            <TrafficAllocationFunnel
              bare
              experiment={experiment}
              editTraffic={
                scheduleArmed || !editTraffic
                  ? null
                  : editable && safeToEdit
                    ? () => setTrafficModalOpen(true)
                    : editTraffic
              }
              editTargeting={scheduleArmed ? null : editTargeting}
              editNamespace={scheduleArmed ? null : editNamespace}
              addVariation={
                scheduleArmed || !addVariation ? null : addVariationInline
              }
              setEditVariationIndex={setEditMetadataIndex}
              canEditExperiment={canEditExperiment}
              safeToEdit={safeToEdit}
              mutate={mutate}
              phaseIndex={experiment.phases.length - 1}
              // Drag-to-reorder edits the draft; Save commits it (set in
              // review). The funnel allows it only before start.
              variationOrder={draft.variations.map((v) => v.id)}
              addedVariations={draftAddedVariations}
              variationEdits={draftVariationEdits}
              draftWeights={draftWeights(draft)}
              // The Edit Split % modal, on a draft only (set in review).
              onEditSplit={
                editable && !scheduleArmed
                  ? (variationId) => {
                      setSplitFocusId(variationId ?? null);
                      setSplitModalOpen(true);
                    }
                  : undefined
              }
              onReorderVariations={
                editable && !scheduleArmed
                  ? (order) =>
                      update({
                        variations: order.flatMap((id) => {
                          const v = draft.variations.find((d) => d.id === id);
                          return v ? [v] : [];
                        }),
                      })
                  : undefined
              }
              onEditVariation={
                // Drafts only, as the "+" (set in review). Once started, the
                // pencil keeps opening the name/description editor, and
                // there's no deleting.
                editable && !scheduleArmed
                  ? (id) => setEditingVariationId(id)
                  : undefined
              }
              header={
                isValuesType ? (
                  <EnvironmentsRow
                    environments={environments}
                    // No pencil while running (set in review).
                    onEdit={
                      canEditExperiment && experiment.status !== "running"
                        ? () => setEnvironmentsModalOpen(true)
                        : undefined
                    }
                  />
                ) : undefined
              }
              // Included % is edited in place on a draft, and saved with the
              // page; otherwise it's read-only here.
              coverage={draft.coverage}
              onCoverageChange={
                editable && !scheduleArmed && editTraffic && safeToEdit
                  ? (coverage) => update({ coverage })
                  : undefined
              }
              variationRow={
                isValuesType
                  ? {
                      header: (
                        <ValuesRowHeader
                          dataType={valuesDraft.dataType}
                          setDataType={(dataType) =>
                            setValuesDraft((prev) => ({ ...prev, dataType }))
                          }
                          editable={valuesEditable}
                        />
                      ),
                      renderCell: (variationId) => (
                        // The To Do list's "Set Variation Values" jump target.
                        <Box id={`setup-value-${variationId}`}>
                          <ValueInput
                            dataType={valuesDraft.dataType}
                            value={
                              valuesDraft.valuesByVariationId[variationId] ?? ""
                            }
                            onChange={(value) =>
                              setValuesDraft((prev) => ({
                                ...prev,
                                valuesByVariationId: {
                                  ...prev.valuesByVariationId,
                                  [variationId]: value,
                                },
                              }))
                            }
                            editable={valuesEditable}
                            variationName={
                              experiment.variations.find(
                                (v) => v.id === variationId,
                              )?.name ?? ""
                            }
                            variationIndex={Math.max(
                              0,
                              experiment.variations.findIndex(
                                (v) => v.id === variationId,
                              ),
                            )}
                          />
                        </Box>
                      ),
                    }
                  : undefined
              }
            />
            {/* Only the current type's linked changes. A Values experiment has
            none, so the section doesn't render for it. */}
            {deliveryType !== "values" ? (
              <Box mt="4">
                <LinkedChanges
                  deliveryType={deliveryType}
                  linkedFeatures={linkedFeatures}
                  experiment={experiment}
                  canAddChanges={canAddLinkedChanges}
                  visualChangesets={visualChangesets}
                  urlRedirects={urlRedirects}
                  mutate={mutate}
                  canEditVisualChangesets={hasVisualEditorPermission}
                  visualChangesetEnvStates={visualChangesetEnvStates}
                  urlRedirectEnvStates={urlRedirectEnvStates}
                  setVisualEditorModal={setVisualEditorModal}
                  setFeatureModal={setFeatureModal}
                  setUrlRedirectModal={setUrlRedirectModal}
                  onAddVariation={editVariations ?? undefined}
                  canEditExperiment={canEditExperiment}
                  setEditVariationIndex={setEditMetadataIndex}
                  hideVariations
                />
              </Box>
            ) : null}
            {(experiment.status !== "draft" || scheduleArmed) &&
            !isValuesType &&
            !hasLinkedChanges ? (
              <Callout status="info" mt="4">
                This experiment has no linked GrowthBook implementation (linked
                feature flag, visual editor changes, or URL redirect). The
                implementation, traffic, and targeting may be managed by an
                external system.
              </Callout>
            ) : null}
          </GreyContainer>

          <SectionDivider />

          <AnalysisPlan
            experiment={experiment}
            draft={draft}
            update={update}
            editable={editable}
            startLocked={scheduleArmed}
            onEditSchedule={
              scheduleArmed && permissionsUtil.canRunExperiment(experiment, [])
                ? () => setScheduleModalOpen(true)
                : undefined
            }
            canEditAnalysisSettings={
              !!editTargeting && canEditExperiment && !scheduleArmed
            }
            onAdvancedStateChange={onAdvancedStateChange}
          />

          {/* Not in the design. Kept so organizations with custom fields don't
          lose them on this tab. */}
          <Box mt="5">
            <CustomFieldDisplay
              target={experiment}
              canEdit={canEditExperiment}
              mutate={mutate}
              section="experiment"
            />
          </Box>
        </Box>

        {/* Always mounted, so collapsing can slide rather than vanish. */}
        <SetupRail
          collapsed={railCollapsed}
          experiment={experiment}
          // On a draft, the rail shows the draft and its modals apply to it
          // (set in review); the save bar saves them.
          draft={editable ? { values: draft, update } : undefined}
          mutate={mutate}
          canEdit={canEditExperiment}
          envs={envs}
          linkedFeatures={linkedFeatures}
          visualChangesetCount={visualChangesets.length}
          urlRedirectCount={urlRedirects.length}
          // The type can't change after the experiment starts (the modal says
          // so), so the rail's pencil is only offered on a draft.
          onChangeType={
            canEditExperiment && experiment.status === "draft"
              ? () => setTypeModalOpen(true)
              : undefined
          }
          bottomInset={footerHeight}
        />
      </Flex>

      {/* The commit boundary for the whole page, per the design: a bar
        across the full width, under the rail too, with Discard Changes and
        Save on the right. Only present while there's something to commit,
        and pinned to the bottom of the window so it stays reachable from any
        section. */}
      {showFooter ? (
        <Box
          ref={footerRef}
          // Rises in briefly when it appears, to draw the eye (set in
          // review; see .footerRaise).
          className={styles.footerRaise}
          style={{
            position: "sticky",
            bottom: 0,
            // Above the rail (931), which it spans.
            zIndex: 932,
            // Out to the page's left edge, past its 32px padding (the page
            // has no right padding), then 32px back in: the design's 12px
            // 32px.
            marginLeft: "calc(-1 * var(--space-6))",
            padding: "var(--space-3) var(--space-6)",
            backgroundColor: "var(--slate-2)",
            borderTop: "1px solid var(--gray-a5)",
          }}
        >
          {error ? (
            <Callout status="error" mb="3">
              {error}
            </Callout>
          ) : null}
          <Flex justify="end" align="center" gap="3">
            <Button variant="ghost" onClick={discard} disabled={saving}>
              Discard Changes
            </Button>
            <Button onClick={save} loading={saving} disabled={!dirty}>
              Save
            </Button>
          </Flex>
        </Box>
      ) : null}
    </Flex>
  );
}
