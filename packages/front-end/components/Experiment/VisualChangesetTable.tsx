import React, { useCallback, useMemo, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
} from "shared/types/experiment";
import {
  VisualChange,
  VisualChangesetInterface,
} from "shared/types/visual-changeset";
import { getLatestPhaseVariations } from "shared/experiments";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiArrowSquareOut,
  PiArrowsOutCardinalBold,
  PiCaretRight,
  PiCodeBold,
  PiDesktop,
  PiImageBold,
  PiPaintBrushBold,
  PiPencilSimple,
  PiTextTBold,
  PiTrashBold,
  PiWarningFill,
} from "react-icons/pi";
import track from "@/services/track";
import { appendQueryParamsToURL } from "@/services/utils";
import { useAuth } from "@/services/auth";
import VisualChangesetModal from "@/components/Experiment/VisualChangesetModal";
import EditDOMMutationsModal from "@/components/Experiment/EditDOMMutationsModal";
import ImplementationHeading from "@/components/Experiment/ImplementationHeading";
import { SdkConnectionEnvironmentsPopover } from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import { useLinkedChangeAddGate } from "@/components/Experiment/LinkedChanges/AddLinkedChanges";
import {
  AddImplementationButton,
  CardHeaderDivider,
  ImplementationCard,
  ImplementationCardHeader,
  ImplementationSection,
  VariationCells,
} from "@/components/Experiment/TabbedPage/ImplementationCard";
import OpenVisualEditorLink from "@/components/OpenVisualEditorLink";
import ConfirmDialog from "@/ui/ConfirmDialog";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import {
  ChangeType,
  Humanized,
  humanizeGlobalBlock,
  humanizeMutation,
} from "./visualChangesetHumanize";
import styles from "./VisualChangesetTable.module.scss";

/** Stored editor URLs often omit a protocol; Next.js Link treats those as
 * app-relative paths. */
function normalizeVisualEditorUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (!trimmed.match(/^http(s)?:/)) {
    return `http://${trimmed}`;
  }
  return trimmed;
}

// Count of distinct change units in a VisualChange (each DOM mutation +
// non-empty CSS + non-empty JS). Drives the variation-row summary.
function visualChangeCount(change?: VisualChange): number {
  if (!change) return 0;
  return (
    (change.css?.trim() ? 1 : 0) +
    (change.js?.trim() ? 1 : 0) +
    (change.domMutations?.length || 0)
  );
}

// Pretty-print a CSS string for the per-row code disclosure. The visual
// editor's Global CSS often arrives as one minified line; this gives it
// scannable indentation + line-breaks without parsing anything beyond
// `{` / `}` / `;` and string literals.
function prettyPrintCss(css: string): string {
  const src = css.trim();
  if (!src) return src;
  let depth = 0;
  let out = "";
  let inString: '"' | "'" | null = null;
  const indent = () => "  ".repeat(depth);
  const skipWs = (from: number): number => {
    let k = from;
    while (k < src.length && /[ \t\n\r]/.test(src[k])) k++;
    return k - 1;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      out += c;
      if (c === "\\" && i + 1 < src.length) {
        out += src[i + 1];
        i++;
      } else if (c === inString) {
        inString = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      out += c;
      continue;
    }
    if (c === "{") {
      depth++;
      out = out.replace(/\s+$/, "") + " {\n" + indent();
      i = skipWs(i + 1);
      continue;
    }
    if (c === "}") {
      depth = Math.max(0, depth - 1);
      out = out.replace(/\s+$/, "") + "\n" + indent() + "}\n" + indent();
      i = skipWs(i + 1);
      continue;
    }
    if (c === ";") {
      out += ";\n" + indent();
      i = skipWs(i + 1);
      continue;
    }
    out += c;
  }
  return out
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join("\n")
    .trim();
}

// Per-change-type icon used in the change-row's left tile. The size/color
// come from the wrapper; this is just the glyph.
function TypeIcon({ type }: { type: ChangeType }) {
  switch (type) {
    case "spacing":
      return <PiArrowsOutCardinalBold size={15} />;
    case "image":
      return <PiImageBold size={15} />;
    case "style":
      return <PiPaintBrushBold size={15} />;
    case "text":
      return <PiTextTBold size={15} />;
    case "css":
      return <PiCodeBold size={15} />;
  }
}

// Per change-type tone vars consumed by `.typeTile` + `.afterChip`. Each
// type maps to a Radix color scale; --N-9 (solid) / --N-a3 (soft alpha)
// / --N-11 (low-contrast text) means dark mode swaps for free. Pushed
// via inline `style` rather than per-type CSS classes to avoid five
// near-identical class definitions in the module.
function toneVars(type: ChangeType): React.CSSProperties {
  const scale = (() => {
    switch (type) {
      case "spacing":
        return "orange";
      case "image":
        return "green";
      case "style":
        return "accent"; // matches the app's accent (violet)
      case "text":
        return "blue";
      case "css":
        return "indigo";
    }
  })();
  return {
    ["--tone-solid" as string]: `var(--${scale}-9)`,
    ["--tone-soft" as string]: `var(--${scale}-a3)`,
    ["--tone-text" as string]: `var(--${scale}-11)`,
  };
}

// Targeting-rule pill (Applies-to / Except rows). Includes get a green dot,
// excludes a red dot; regex patterns get a small ".*" badge.
function RuleChip({
  rule,
}: {
  rule: { include: boolean; type: "simple" | "regex"; pattern: string };
}) {
  const inc = rule.include;
  return (
    <span
      className={`${styles.ruleChip}${inc ? "" : " " + styles.ruleChipExclude}`}
    >
      <span
        className={`${styles.ruleDot}${inc ? "" : " " + styles.ruleDotExclude}`}
      />
      <code
        className={`${styles.rulePattern}${inc ? "" : " " + styles.rulePatternExclude}`}
      >
        {rule.pattern}
      </code>
      {rule.type === "regex" && (
        <span className={styles.regexBadge} title="Regular expression">
          .*
        </span>
      )}
    </span>
  );
}

// One row in the expanded change list under a variation. Renders the
// design's type tile + verb/title + selector chip + after chip + per-row
// code disclosure + optional delete.
function ChangeRow({
  h,
  onDelete,
}: {
  h: Humanized;
  // When provided, a small trash icon button appears on the right with
  // a ConfirmDialog gate. Omitted when the user can't edit this
  // experiment so the row is read-only.
  onDelete?: () => Promise<void>;
}) {
  const [showCode, setShowCode] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Falls to true when the preview image fails to load (404, CORS-
  // blocked, etc.) — the thumbnail is hidden and the user sees the
  // raw src URL only. Cheap and graceful; no need for a Suspense-y
  // loading state since the image is lazy and inside a collapsed panel.
  const [imageError, setImageError] = useState(false);
  // Lazily compute the displayed code text — for CSS-typed rows we
  // pretty-print, for mutation rows the rawLines are already one
  // declaration per line (or a short status note). Gated on
  // `showCode` so the pretty-printer doesn't run on every render of a
  // closed row (most rows stay closed; some changesets have many).
  const codeText = useMemo(() => {
    if (!showCode) return "";
    return h.type === "css"
      ? prettyPrintCss(h.rawLines.join("\n"))
      : h.rawLines.join("\n");
  }, [showCode, h.type, h.rawLines]);

  return (
    <Box className={styles.change} style={toneVars(h.type)}>
      <Flex className={styles.changeHead}>
        <span className={styles.typeTile}>
          <TypeIcon type={h.type} />
        </span>
        <Box className={styles.changeText}>
          <Flex className={styles.changeHeadline}>
            <span className={styles.changeVerbTitle}>
              {h.verb} {h.title}
            </span>
          </Flex>
          <Box className={styles.changeHuman}>{h.human}</Box>
        </Box>
        {h.after && <span className={styles.afterChip}>{h.after}</span>}
        <button
          type="button"
          className={`${styles.codeToggle}${showCode ? " " + styles.codeToggleOpen : ""}`}
          onClick={() => setShowCode((s) => !s)}
          title={showCode ? "Hide raw values" : "Show raw values"}
          aria-pressed={showCode}
        >
          <PiCodeBold size={13} />
        </button>
        {onDelete && (
          <button
            type="button"
            className={styles.deleteRowBtn}
            onClick={() => setConfirmingDelete(true)}
            title="Delete this change"
            aria-label="Delete this change"
          >
            <PiTrashBold size={13} />
          </button>
        )}
      </Flex>
      {confirmingDelete && onDelete && (
        <ConfirmDialog
          title="Delete this change?"
          content={
            <>
              <strong>
                {h.verb} {h.title}
              </strong>{" "}
              on <code>{h.selectorLabel}</code> will be removed from this
              variation. Other changes in this variation are unaffected.
            </>
          }
          yesText="Delete"
          onConfirm={async () => {
            await onDelete();
            setConfirmingDelete(false);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
      {showCode && (
        <Box className={styles.codePanel}>
          {/* The CSS selector lives here in the raw-values panel rather
              than next to the human-readable description — it's an
              implementation detail, not human-readable. */}
          <div className={styles.appliesTo}>
            <span className={styles.appliesToLabel}>Applies to:</span>
            <code className={styles.selectorChip}>{h.selectorLabel}</code>
          </div>
          {h.imageUrl && !imageError && (
            <Box className={styles.imagePreview}>
              <img
                src={h.imageUrl}
                alt=""
                loading="lazy"
                onError={() => setImageError(true)}
              />
            </Box>
          )}
          <pre className={styles.codeBlock}>{codeText}</pre>
        </Box>
      )}
    </Box>
  );
}

type ShownVariation = ReturnType<typeof getLatestPhaseVariations>[number];

type ChangeListRow = {
  key: string;
  humanized: Humanized;
  onDelete?: () => Promise<void>;
};

type ChangeHandlers = {
  onDeleteDomMutation: (args: {
    visualChangeset: VisualChangesetInterface;
    visualChangeIndex: number;
    mutationIndex: number;
  }) => Promise<void>;
  onClearGlobal: (args: {
    visualChangeset: VisualChangesetInterface;
    visualChangeIndex: number;
    kind: "css" | "js";
  }) => Promise<void>;
};

// One row per DOM mutation, then the global CSS and JS. Keyed by the
// mutation's identity rather than its index, so a row's open state stays put
// when another is removed.
function changeRowsFor(
  vc: VisualChangesetInterface,
  variationId: string,
  canEdit: boolean,
  { onDeleteDomMutation, onClearGlobal }: ChangeHandlers,
): ChangeListRow[] {
  const changeIdx = vc.visualChanges.findIndex(
    (c) => c.variation === variationId,
  );
  const change = vc.visualChanges[changeIdx];
  if (!change) return [];
  const rows: ChangeListRow[] = (change.domMutations || []).map((m, i) => ({
    key: `mut:${m.selector}|${m.attribute}|${m.action}|${i}`,
    humanized: humanizeMutation(m),
    onDelete: canEdit
      ? () =>
          onDeleteDomMutation({
            visualChangeset: vc,
            visualChangeIndex: changeIdx,
            mutationIndex: i,
          })
      : undefined,
  }));
  (["css", "js"] as const).forEach((kind) => {
    const value = change[kind];
    if (!value?.trim()) return;
    rows.push({
      key: `global:${kind}`,
      humanized: humanizeGlobalBlock({ kind, value }),
      onDelete: canEdit
        ? () =>
            onClearGlobal({
              visualChangeset: vc,
              visualChangeIndex: changeIdx,
              kind,
            })
        : undefined,
    });
  });
  return rows;
}

// Where the changeset applies: the first page it targets, and how many more.
function AppliesTo({
  urlPatterns,
}: {
  urlPatterns: VisualChangesetInterface["urlPatterns"];
}) {
  const includes = urlPatterns.filter((p) => p.include);
  const [first, ...rest] = [
    ...includes,
    ...urlPatterns.filter((p) => !p.include),
  ];
  if (!first) return null;
  return (
    <Flex align="center" gap="2" minWidth="0" wrap="wrap">
      <Text color="text-low">
        {includes.length ? "Applies to" : "Applies everywhere except"}
      </Text>
      <RuleChip rule={first} />
      {rest.length ? (
        <Tooltip
          content={
            <Flex direction="column" gap="1">
              {rest.map((p, i) => (
                <span key={i}>
                  {p.include ? "" : "Except "}
                  <code>{p.pattern}</code>
                </span>
              ))}
            </Flex>
          }
        >
          <span className={styles.ruleChip}>
            <Text size="sm" color="text-low">
              +{rest.length}
            </Text>
          </span>
        </Tooltip>
      ) : null}
    </Flex>
  );
}

// A variation's changes in full, with its preview.
function VariationChangesModal({
  vc,
  experiment,
  variation,
  rows,
  onEdit,
  close,
}: {
  vc: VisualChangesetInterface;
  experiment: ExperimentInterfaceStringDates;
  variation: ShownVariation;
  rows: ChangeListRow[];
  // Absent when the changes can't be edited.
  onEdit: (() => void) | null;
  close: () => void;
}) {
  // Forces this variation through the experiment's key, by its saved index;
  // one only staged has none yet.
  const base = normalizeVisualEditorUrl(vc.editorUrl);
  const savedIndex = getLatestPhaseVariations(experiment).findIndex(
    (v) => v.id === variation.id,
  );
  const previewUrl =
    base && savedIndex >= 0
      ? appendQueryParamsToURL(base, {
          [experiment.trackingKey]: savedIndex,
        })
      : null;
  return (
    <ModalStandard
      trackingEventModalType="visual-changes"
      open
      header={`Visual Changes: ${variation.name}`}
      subheader={
        vc.urlPatterns?.length ? (
          <AppliesTo urlPatterns={vc.urlPatterns} />
        ) : null
      }
      headerAction={
        previewUrl ? (
          <Link href={previewUrl} external>
            <Flex align="center" gap="1">
              Preview <PiArrowSquareOut />
            </Flex>
          </Link>
        ) : null
      }
      secondaryAction={
        onEdit ? (
          <Button variant="ghost" onClick={onEdit}>
            Edit changes
          </Button>
        ) : null
      }
      closeCta="Close"
      close={close}
      size="lg"
    >
      {rows.length ? (
        <Flex className={styles.changeList} direction="column">
          {rows.map((row) => (
            <ChangeRow
              key={row.key}
              h={row.humanized}
              onDelete={row.onDelete}
            />
          ))}
        </Flex>
      ) : (
        <Flex direction="column" align="center" gap="1" py="6">
          <Text weight="semibold">No changes on {variation.name}</Text>
          <Text color="text-low">This variation shows the page as it is.</Text>
        </Flex>
      )}
    </ModalStandard>
  );
}

function VisualChangesetCard({
  vc,
  experiment,
  variations,
  canEdit,
  canLaunch,
  environmentStates,
  handlers,
  onEditTargeting,
  onEditChanges,
  onRemove,
}: {
  vc: VisualChangesetInterface;
  experiment: ExperimentInterfaceStringDates;
  variations: ShownVariation[];
  canEdit: boolean;
  // The editor only opens while the experiment is a draft.
  canLaunch: boolean;
  environmentStates?: LinkedChangeEnvStates;
  handlers: ChangeHandlers;
  onEditTargeting: () => void;
  onEditChanges: (variationId: string) => void;
  onRemove: () => Promise<void>;
}) {
  const [viewing, setViewing] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const rowsByVariation = useMemo(
    () =>
      new Map(
        variations.map((v) => [
          v.id,
          changeRowsFor(vc, v.id, canEdit, handlers),
        ]),
      ),
    [variations, vc, canEdit, handlers],
  );
  const hasChanges = vc.visualChanges.some((c) => visualChangeCount(c) > 0);
  const viewed = variations.find((v) => v.id === viewing);

  return (
    <ImplementationCard>
      {viewed ? (
        <VariationChangesModal
          vc={vc}
          experiment={experiment}
          variation={viewed}
          rows={rowsByVariation.get(viewed.id) ?? []}
          onEdit={
            canEdit && vc.visualChanges.some((c) => c.variation === viewed.id)
              ? () => {
                  setViewing(null);
                  onEditChanges(viewed.id);
                }
              : null
          }
          close={() => setViewing(null)}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title="Remove Visual Editor changes"
          content={`Every variation's changes to ${vc.editorUrl || "this page"} are removed from the experiment.`}
          yesText="Remove"
          onConfirm={async () => {
            await onRemove();
            setRemoving(false);
          }}
          onCancel={() => setRemoving(false)}
        />
      ) : null}
      <ImplementationCardHeader
        icon={<PiDesktop />}
        title={
          vc.urlPatterns?.length ? (
            <AppliesTo urlPatterns={vc.urlPatterns} />
          ) : (
            <Text weight="medium">{vc.editorUrl || "No URL"}</Text>
          )
        }
        meta={
          hasChanges ? null : (
            <Flex align="center" gap="1" style={{ color: "var(--amber-11)" }}>
              <PiWarningFill />
              <Text size="sm" weight="medium">
                No changes yet
              </Text>
            </Flex>
          )
        }
        actions={
          <>
            {environmentStates ? (
              <SdkConnectionEnvironmentsPopover
                environmentStates={environmentStates}
                kind="Visual Editor"
              />
            ) : null}
            {canEdit && canLaunch ? (
              <>
                <CardHeaderDivider />
                <OpenVisualEditorLink
                  visualChangeset={vc}
                  useLink
                  button={
                    <Flex align="center" gap="1">
                      <PiPencilSimple size="14" />
                      <Text size="sm" weight="medium">
                        Open Visual Editor
                      </Text>
                    </Flex>
                  }
                />
              </>
            ) : null}
          </>
        }
        menuLabel="Visual Editor changes actions"
        menu={
          canEdit ? (
            <>
              <DropdownMenuItem onClick={onEditTargeting}>
                Edit targeting
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem color="red" onClick={() => setRemoving(true)}>
                Remove from experiment
              </DropdownMenuItem>
            </>
          ) : null
        }
      />
      <VariationCells variations={variations}>
        {(v) => {
          const rows = rowsByVariation.get(v.id) ?? [];
          const [first] = rows;
          return (
            <button
              type="button"
              className={styles.changesToggle}
              onClick={() => setViewing(v.id)}
              style={{ width: "100%", justifyContent: "space-between" }}
            >
              <span className="text-ellipsis" style={{ minWidth: 0 }}>
                {first ? (
                  `${first.humanized.verb} ${first.humanized.title}${
                    rows.length > 1 ? `, +${rows.length - 1}` : ""
                  }`
                ) : (
                  <Text color="text-low" weight="regular">
                    No visual changes
                  </Text>
                )}
              </span>
              <span className={styles.changesChev}>
                <PiCaretRight size={11} />
              </span>
            </button>
          );
        }}
      </VariationCells>
    </ImplementationCard>
  );
}

/** The experiment's Visual Editor changes: a card per page, a summary per variation. */
export default function VisualEditorRows({
  experiment,
  variations,
  visualChangesets,
  canEdit,
  mutate,
  environmentStates,
  onAdd,
  addBlockedReason = null,
}: {
  experiment: ExperimentInterfaceStringDates;
  // As the variation cards above show them, staged edits included.
  variations: ShownVariation[];
  visualChangesets: VisualChangesetInterface[];
  canEdit: boolean;
  mutate: () => void;
  environmentStates?: LinkedChangeEnvStates;
  onAdd: (() => void) | null;
  addBlockedReason?: string | null;
}) {
  const { apiCall } = useAuth();
  const { unsupportedReason, commercialFeature } = useLinkedChangeAddGate(
    "visual",
    experiment,
  );
  const [editingVisualChangeset, setEditingVisualChangeset] =
    useState<VisualChangesetInterface | null>(null);
  const [editingVisualChange, setEditingVisualChange] = useState<{
    visualChangeset: VisualChangesetInterface;
    visualChange: VisualChange;
    visualChangeIndex: number;
  } | null>(null);

  const putVisualChange = useCallback(
    async (
      visualChangeset: VisualChangesetInterface,
      index: number,
      visualChange: VisualChange,
    ) => {
      await apiCall(`/visual-changesets/${visualChangeset.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...visualChangeset,
          visualChanges: visualChangeset.visualChanges.map((c, i) =>
            i === index ? visualChange : c,
          ),
        }),
      });
      mutate();
    },
    [apiCall, mutate],
  );

  // The row for the variation stays, empty: the editor expects one each.
  const handlers: ChangeHandlers = useMemo(
    () => ({
      onDeleteDomMutation: async ({
        visualChangeset,
        visualChangeIndex,
        mutationIndex,
      }) => {
        const existing = visualChangeset.visualChanges[visualChangeIndex];
        if (!existing) return;
        await putVisualChange(visualChangeset, visualChangeIndex, {
          ...existing,
          domMutations: existing.domMutations.filter(
            (_, i) => i !== mutationIndex,
          ),
        });
        track("Delete visual change", {
          source: "visual-editor-ui",
          kind: "mutation",
        });
      },
      onClearGlobal: async ({ visualChangeset, visualChangeIndex, kind }) => {
        const existing = visualChangeset.visualChanges[visualChangeIndex];
        if (!existing) return;
        await putVisualChange(visualChangeset, visualChangeIndex, {
          ...existing,
          [kind]: "",
        });
        track("Delete visual change", {
          source: "visual-editor-ui",
          kind: kind === "css" ? "globalCss" : "globalJs",
        });
      },
    }),
    [putVisualChange],
  );

  return (
    <ImplementationSection
      cols={Math.min(variations.length, 3)}
      heading={
        <ImplementationHeading inList>
          Visual Editor Changes
        </ImplementationHeading>
      }
      add={
        onAdd ? (
          <AddImplementationButton
            label="Add Visual Editor changes"
            onClick={onAdd}
            disabledReason={addBlockedReason ?? unsupportedReason}
            commercialFeature={commercialFeature}
          />
        ) : null
      }
    >
      {editingVisualChangeset ? (
        <VisualChangesetModal
          mode="edit"
          experiment={experiment}
          visualChangeset={editingVisualChangeset}
          mutate={mutate}
          close={() => setEditingVisualChangeset(null)}
          source="visual-changeset-table"
        />
      ) : null}
      {editingVisualChange ? (
        <EditDOMMutationsModal
          experiment={experiment}
          visualChange={editingVisualChange.visualChange}
          close={() => setEditingVisualChange(null)}
          onSave={async (newVisualChange) => {
            await putVisualChange(
              editingVisualChange.visualChangeset,
              editingVisualChange.visualChangeIndex,
              newVisualChange,
            );
            track("Edit visual change", { source: "visual-editor-ui" });
          }}
        />
      ) : null}
      {visualChangesets.map((vc) => (
        <VisualChangesetCard
          key={vc.id}
          vc={vc}
          experiment={experiment}
          variations={variations}
          canEdit={canEdit}
          canLaunch={
            experiment.status === "draft" &&
            !experiment.nextScheduledStatusUpdate
          }
          environmentStates={environmentStates}
          handlers={handlers}
          onEditTargeting={() => {
            setEditingVisualChangeset(vc);
            track("Open visual editor modal", {
              source: "visual-editor-ui",
              action: "edit",
            });
          }}
          onEditChanges={(variationId) => {
            const visualChangeIndex = vc.visualChanges.findIndex(
              (c) => c.variation === variationId,
            );
            const visualChange = vc.visualChanges[visualChangeIndex];
            if (visualChange) {
              setEditingVisualChange({
                visualChangeset: vc,
                visualChange,
                visualChangeIndex,
              });
            }
          }}
          onRemove={async () => {
            await apiCall(`/visual-changesets/${vc.id}`, { method: "DELETE" });
            mutate();
            track("Delete visual changeset", { source: "visual-editor-ui" });
          }}
        />
      ))}
    </ImplementationSection>
  );
}
