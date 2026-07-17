import React, { FC, useCallback, useMemo, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
} from "shared/types/experiment";
import {
  VisualChange,
  VisualChangesetInterface,
} from "shared/types/visual-changeset";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import { Box, Flex, Separator } from "@radix-ui/themes";
import {
  PiArrowSquareOut,
  PiArrowSquareOutBold,
  PiArrowsOutCardinalBold,
  PiCaretDown,
  PiCaretRight,
  PiCodeBold,
  PiImageBold,
  PiPaintBrushBold,
  PiTextTBold,
  PiTrashBold,
} from "react-icons/pi";
import track from "@/services/track";
import { appendQueryParamsToURL, decimalToPercent } from "@/services/utils";
import { useAuth } from "@/services/auth";
import VisualChangesetModal from "@/components/Experiment/VisualChangesetModal";
import EditDOMMutationsModal from "@/components/Experiment/EditDOMMutationsModal";
import EnvironmentStatesGrid from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import OpenVisualEditorLink from "@/components/OpenVisualEditorLink";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Avatar from "@/ui/Avatar";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Metadata from "@/ui/Metadata";
import VariationLabel from "@/ui/VariationLabel";
import { ICON_PROPERTIES } from "./LinkedChanges/constants";
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

// One variation in a card: swatch + name + split bar + changes toggle +
// preview/edit row actions. Expanded body holds the change rows.
function VariationRow({
  vc,
  experiment,
  variationIndex,
  variationId,
  variationName,
  splitPct,
  canEdit,
  canDeleteVariation,
  defaultOpen,
  isLast,
  setEditingVisualChange,
  onDeleteDomMutation,
  onClearGlobal,
  onDeleteVariation,
}: {
  vc: VisualChangesetInterface;
  experiment: ExperimentInterfaceStringDates;
  variationIndex: number;
  variationId: string;
  variationName: string;
  splitPct: number;
  canEdit: boolean;
  // Whether the row should render its own trash icon (variation-level).
  // Gated by the caller so we can disable for Control / running
  // experiments / when only 2 variations remain.
  canDeleteVariation: boolean;
  defaultOpen: boolean;
  // Whether this is the last variation row. The separator between rows
  // lives inside the component so it inherits the row's horizontal
  // padding; we skip it on the final row.
  isLast: boolean;
  setEditingVisualChange: (params: {
    visualChange: VisualChange;
    visualChangeIndex: number;
    visualChangeset: VisualChangesetInterface;
  }) => void;
  // Delete a single DOM mutation row in this changeset's visualChange
  // entry for this variation. Callback is fully scoped — variation +
  // changeset already bound by the parent.
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
  onDeleteVariation: (variationId: string) => Promise<void>;
}) {
  // The visualChange entry for THIS variation under THIS changeset (data-
  // model invariant from the README — variations are global, but their
  // edits are scoped per-changeset).
  const changeIdx = vc.visualChanges.findIndex(
    (c) => c.variation === variationId,
  );
  const change = changeIdx >= 0 ? vc.visualChanges[changeIdx] : undefined;
  const count = visualChangeCount(change);
  const [open, setOpen] = useState(defaultOpen);
  const [confirmingVariantDelete, setConfirmingVariantDelete] = useState(false);

  // Per-variation preview URL (forces this variation via the experiment's
  // tracking key + the variation INDEX, matching the existing convention).
  const previewUrl = useMemo(() => {
    const base = normalizeVisualEditorUrl(vc.editorUrl);
    if (!base) return null;
    return appendQueryParamsToURL(base, {
      [experiment.trackingKey]: variationIndex,
    });
  }, [vc.editorUrl, experiment.trackingKey, variationIndex]);

  // Build the humanized rows: one per DOM mutation, then global CSS / JS
  // appended as additional rows (the design treats "Added custom CSS" as
  // just another row at the end of the variation's change list).
  //
  // Each row carries a stable key derived from the mutation's identity
  // (selector + attribute + action + position) — NOT just its array
  // index — so React doesn't shuffle per-row state (showCode,
  // imageError) when a mutation is removed or reordered via the Edit
  // modal. Globals get fixed sentinel keys since there's at most one
  // of each. Each row also carries a fully-scoped `onDelete` (or
  // undefined when the user can't edit) so ChangeRow doesn't need to
  // know the row's source kind.
  type ChangeListRow = {
    key: string;
    humanized: Humanized;
    onDelete?: () => Promise<void>;
  };
  const rows: ChangeListRow[] = useMemo(() => {
    if (!change || changeIdx < 0) return [];
    const list: ChangeListRow[] = [];
    (change.domMutations || []).forEach((m, i) => {
      list.push({
        // `i` is the disambiguator if two mutations share selector +
        // attribute + action (rare but possible). Putting it last keeps
        // the key stable when the FIRST occurrence is unchanged.
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
      });
    });
    if (change.css?.trim()) {
      list.push({
        key: "global:css",
        humanized: humanizeGlobalBlock({ kind: "css", value: change.css }),
        onDelete: canEdit
          ? () =>
              onClearGlobal({
                visualChangeset: vc,
                visualChangeIndex: changeIdx,
                kind: "css",
              })
          : undefined,
      });
    }
    if (change.js?.trim()) {
      list.push({
        key: "global:js",
        humanized: humanizeGlobalBlock({ kind: "js", value: change.js }),
        onDelete: canEdit
          ? () =>
              onClearGlobal({
                visualChangeset: vc,
                visualChangeIndex: changeIdx,
                kind: "js",
              })
          : undefined,
      });
    }
    return list;
  }, [change, changeIdx, canEdit, vc, onDeleteDomMutation, onClearGlobal]);

  return (
    <Box className={styles.variationRow}>
      <Flex className={styles.variationHead}>
        <Box flexBasis="25%" flexShrink="0" minWidth="0">
          <VariationLabel
            number={variationIndex}
            name={variationName}
            size="medium"
          />
        </Box>
        <Flex flexBasis="90px" flexShrink="0" justify="end">
          <Metadata label="Split" value={splitPct + "%"} />
        </Flex>
        <Box className={styles.changesArea}>
          {count === 0 ? (
            <span className={styles.changesEmpty}>No visual changes</span>
          ) : (
            <button
              type="button"
              className={`${styles.changesToggle}${open ? " " + styles.changesToggleOpen : ""}`}
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
            >
              {count} visual change{count > 1 ? "s" : ""}
              <span
                className={`${styles.changesChev}${open ? " " + styles.changesChevOpen : ""}`}
              >
                {open ? <PiCaretDown size={11} /> : <PiCaretRight size={11} />}
              </span>
            </button>
          )}
        </Box>
        <Flex className={styles.rowActions}>
          {previewUrl && (
            <Link
              className={styles.ghostAction}
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Preview
              <PiArrowSquareOutBold size={12} />
            </Link>
          )}
          {canEdit && change && (
            <Link
              onClick={() =>
                setEditingVisualChange({
                  visualChange: change,
                  visualChangeIndex: changeIdx,
                  visualChangeset: vc,
                })
              }
            >
              <Text weight="semibold">Edit</Text>
            </Link>
          )}
          {canDeleteVariation && (
            <button
              type="button"
              className={styles.variationDeleteBtn}
              onClick={() => setConfirmingVariantDelete(true)}
              title="Delete this variation"
              aria-label="Delete this variation"
            >
              <PiTrashBold size={13} />
            </button>
          )}
        </Flex>
      </Flex>
      {confirmingVariantDelete && (
        <ConfirmDialog
          title={`Delete "${variationName}"?`}
          content={
            <>
              This will remove <strong>{variationName}</strong> from the
              experiment, along with all of its visual changes across every
              targeted URL. Other variations are unaffected. This can&rsquo;t be
              undone.
            </>
          }
          yesText="Delete variation"
          onConfirm={async () => {
            await onDeleteVariation(variationId);
            setConfirmingVariantDelete(false);
          }}
          onCancel={() => setConfirmingVariantDelete(false)}
        />
      )}
      {open && rows.length > 0 && (
        <Flex className={styles.changeList} direction="column">
          {rows.map((row) => (
            <ChangeRow
              key={row.key}
              h={row.humanized}
              onDelete={row.onDelete}
            />
          ))}
        </Flex>
      )}
      {!isLast && <Separator size="4" mt="2" />}
    </Box>
  );
}

// Targeting rows (APPLIES TO + optional EXCEPT). Mode + match-type are
// pulled directly from the changeset's urlPatterns.
function TargetingRows({
  urlPatterns,
  canEdit,
  onEdit,
}: {
  urlPatterns: VisualChangesetInterface["urlPatterns"];
  canEdit: boolean;
  onEdit: () => void;
}) {
  const inc = urlPatterns.filter((p) => p.include);
  const exc = urlPatterns.filter((p) => !p.include);
  return (
    <Flex className={styles.targeting} direction="column">
      <Flex className={styles.targetRow}>
        <span className={styles.targetLabel}>Applies to</span>
        {inc.map((p, i) => (
          <RuleChip key={`inc-${i}-${p.type}-${p.pattern}`} rule={p} />
        ))}
        {canEdit && (
          <Link onClick={onEdit}>
            <Text weight="semibold">Edit</Text>
          </Link>
        )}
      </Flex>
      {exc.length > 0 && (
        <Flex className={styles.targetRow}>
          <span className={`${styles.targetLabel} ${styles.targetLabelExcept}`}>
            Except
          </span>
          {exc.map((p, i) => (
            <RuleChip key={`exc-${i}-${p.type}-${p.pattern}`} rule={p} />
          ))}
        </Flex>
      )}
    </Flex>
  );
}

const VisualEditorIcon = ICON_PROPERTIES["visual-editor"].component;
const radixColor = ICON_PROPERTIES["visual-editor"].radixColor;

function UrlCard({
  vc,
  experiment,
  canEdit,
  envStatesArray,
  onEditTargeting,
  onDeleteChangeset,
  setEditingVisualChange,
  onDeleteDomMutation,
  onClearGlobal,
  onDeleteVariation,
}: {
  vc: VisualChangesetInterface;
  experiment: ExperimentInterfaceStringDates;
  canEdit: boolean;
  envStatesArray: Array<{
    env: string;
    state: string;
    isActive: boolean;
    tooltip: string;
  }>;
  onEditTargeting: () => void;
  onDeleteChangeset: () => void;
  setEditingVisualChange: (params: {
    visualChange: VisualChange;
    visualChangeIndex: number;
    visualChangeset: VisualChangesetInterface;
  }) => void;
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
  onDeleteVariation: (variationId: string) => Promise<void>;
}) {
  const phaseVariations = getLatestPhaseVariations(experiment);
  const latestPhase = experiment.phases?.[experiment.phases.length - 1];
  const editorUrl = vc.editorUrl.trim();
  const linkUrl = normalizeVisualEditorUrl(editorUrl);

  // Compose the "Text and CSS changes" subline by walking the changeset's
  // visualChanges for the kinds present (matches today's behavior).
  const subline = useMemo(() => {
    const kinds = new Set<string>();
    vc.visualChanges.forEach((c) => {
      if (c.domMutations?.length) kinds.add("Text");
      if (c.css?.trim()) kinds.add("CSS");
      if (c.js?.trim()) kinds.add("Javascript");
    });
    const order = ["Text", "CSS", "Javascript"];
    const list = order.filter((k) => kinds.has(k));
    if (list.length === 0) return "No changes yet";
    const joined =
      list.length === 1
        ? list[0]
        : list.length === 2
          ? list.join(" and ")
          : list.slice(0, -1).join(", ") + " and " + list.slice(-1);
    return `${joined} changes`;
  }, [vc.visualChanges]);

  return (
    <Box p="1">
      <Flex align="center" justify="between" mb="3">
        <Flex align="center" gap="3">
          <Avatar radius="small" color={radixColor} size="md" variant="soft">
            <VisualEditorIcon />
          </Avatar>
          <Box className={styles.cardHeaderTitleBlock}>
            <Flex className={styles.cardUrlRow}>
              {linkUrl ? (
                <Link href={linkUrl} target="_blank">
                  <Text weight="semibold">
                    {editorUrl}
                    <PiArrowSquareOut className="ml-2" />
                  </Text>
                </Link>
              ) : (
                <span className={styles.cardUrl}>
                  {editorUrl || "(no URL)"}
                </span>
              )}
            </Flex>
            <span className={styles.cardSummary}>{subline}</span>
          </Box>
        </Flex>
        <Box>
          {canEdit && (
            <DeleteButton
              className="btn-sm ml-4"
              text="Remove"
              stopPropagation={true}
              onClick={() => onDeleteChangeset()}
              displayName="Visual Changeset"
            />
          )}
          {canEdit && experiment.status === "draft" && (
            <OpenVisualEditorLink
              useRadix={false}
              visualChangeset={vc}
              useLink
              button={<Button variant="ghost">Launch visual editor</Button>}
            />
          )}
        </Box>
      </Flex>
      <Box mb="5" className="appbox" style={{ backgroundColor: "transparent" }}>
        {/* Targeting */}
        {vc.urlPatterns?.length > 0 && (
          <TargetingRows
            urlPatterns={vc.urlPatterns}
            canEdit={canEdit}
            onEdit={onEditTargeting}
          />
        )}

        {/* Variations */}
        <Box>
          {phaseVariations.map((v, j) => (
            <VariationRow
              key={v.id}
              vc={vc}
              experiment={experiment}
              variationIndex={j}
              variationId={v.id}
              variationName={v.name}
              splitPct={decimalToPercent(
                latestPhase?.variationWeights?.[j] ?? 0,
              )}
              canEdit={canEdit}
              // Deleting a variation is allowed only on drafts (running
              // experiments shouldn't lose buckets retroactively), only
              // for non-Control rows, and only when removing one would
              // still leave a valid experiment (>= 2 variations). The
              // base canEdit permission also has to hold.
              canDeleteVariation={
                canEdit &&
                j !== 0 &&
                experiment.status === "draft" &&
                phaseVariations.length > 2
              }
              // All variations start collapsed — matches the environments
              // drop-down pattern used elsewhere on this page. Users opt
              // in to seeing the change list by clicking the chevron.
              defaultOpen={false}
              isLast={j === phaseVariations.length - 1}
              setEditingVisualChange={setEditingVisualChange}
              onDeleteDomMutation={onDeleteDomMutation}
              onClearGlobal={onClearGlobal}
              onDeleteVariation={onDeleteVariation}
            />
          ))}
        </Box>

        {/* Environments footer — uses the shared EnvironmentStatesGrid
          which renders a clickable "Environments (active / total)"
          header that expands to a per-env check / warning grid with
          per-env tooltips. Same component the prior layout used; we
          just give it a hairline above to fit the card's banded look. */}
        {envStatesArray.length > 0 && (
          <Box className={styles.cardFooter}>
            <EnvironmentStatesGrid environmentStates={envStatesArray} />
          </Box>
        )}
      </Box>
    </Box>
  );
}

type Props = {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  mutate?: () => void;
  canEditVisualChangesets: boolean;
  environmentStates?: LinkedChangeEnvStates;
};

export const VisualChangesetTable: FC<Props> = ({
  experiment,
  visualChangesets = [],
  mutate,
  canEditVisualChangesets,
  environmentStates,
}: Props) => {
  const { apiCall } = useAuth();

  const [editingVisualChangeset, setEditingVisualChangeset] =
    useState<VisualChangesetInterface | null>(null);

  const [editingVisualChange, setEditingVisualChange] = useState<{
    visualChangeset: VisualChangesetInterface;
    visualChange: VisualChange;
    visualChangeIndex: number;
  } | null>(null);

  const deleteVisualChangeset = useCallback(
    async (id: string) => {
      await apiCall(`/visual-changesets/${id}`, {
        method: "DELETE",
      });
      mutate?.();
      track("Delete visual changeset", {
        source: "visual-editor-ui",
      });
    },
    [apiCall, mutate],
  );

  const updateVisualChange = useCallback(
    async ({
      visualChangeset,
      visualChange,
      index,
    }: {
      visualChangeset: VisualChangesetInterface;
      visualChange: VisualChange;
      index: number;
    }) => {
      const newVisualChangeset: VisualChangesetInterface = {
        ...visualChangeset,
        visualChanges: visualChangeset.visualChanges.map((c, i) =>
          i === index ? visualChange : c,
        ),
      };
      await apiCall(`/visual-changesets/${visualChangeset.id}`, {
        method: "PUT",
        body: JSON.stringify(newVisualChangeset),
      });
      mutate?.();
      track("Edit visual change", {
        source: "visual-editor-ui",
      });
    },
    [apiCall, mutate],
  );

  // Remove a single DOM mutation from a variation's visualChange entry.
  // The variation's row in `visualChanges` is updated wholesale via PUT,
  // matching the pattern updateVisualChange uses. The row stays even if
  // it ends up with zero mutations + no CSS/JS — empty rows are
  // semantically distinct from a missing row, and the EditDOMMutations
  // modal expects one per variation.
  const deleteDomMutation = useCallback(
    async ({
      visualChangeset,
      visualChangeIndex,
      mutationIndex,
    }: {
      visualChangeset: VisualChangesetInterface;
      visualChangeIndex: number;
      mutationIndex: number;
    }) => {
      const existing = visualChangeset.visualChanges[visualChangeIndex];
      if (!existing) return;
      const nextVisualChange: VisualChange = {
        ...existing,
        domMutations: existing.domMutations.filter(
          (_, i) => i !== mutationIndex,
        ),
      };
      const newVisualChangeset: VisualChangesetInterface = {
        ...visualChangeset,
        visualChanges: visualChangeset.visualChanges.map((c, i) =>
          i === visualChangeIndex ? nextVisualChange : c,
        ),
      };
      await apiCall(`/visual-changesets/${visualChangeset.id}`, {
        method: "PUT",
        body: JSON.stringify(newVisualChangeset),
      });
      mutate?.();
      track("Delete visual change", {
        source: "visual-editor-ui",
        kind: "mutation",
      });
    },
    [apiCall, mutate],
  );

  // Clear the Global CSS or Custom JS block on a variation's
  // visualChange entry. Sets the field to "" (the canonical "empty"
  // state we test for elsewhere via `.trim()`). Same PUT shape.
  const clearGlobalBlock = useCallback(
    async ({
      visualChangeset,
      visualChangeIndex,
      kind,
    }: {
      visualChangeset: VisualChangesetInterface;
      visualChangeIndex: number;
      kind: "css" | "js";
    }) => {
      const existing = visualChangeset.visualChanges[visualChangeIndex];
      if (!existing) return;
      const nextVisualChange: VisualChange = {
        ...existing,
        ...(kind === "css" ? { css: "" } : { js: "" }),
      };
      const newVisualChangeset: VisualChangesetInterface = {
        ...visualChangeset,
        visualChanges: visualChangeset.visualChanges.map((c, i) =>
          i === visualChangeIndex ? nextVisualChange : c,
        ),
      };
      await apiCall(`/visual-changesets/${visualChangeset.id}`, {
        method: "PUT",
        body: JSON.stringify(newVisualChangeset),
      });
      mutate?.();
      track("Delete visual change", {
        source: "visual-editor-ui",
        kind: kind === "css" ? "globalCss" : "globalJs",
      });
    },
    [apiCall, mutate],
  );

  // Remove a variation from the experiment AND clean up any matching
  // `visualChange` rows in every changeset. We do the experiment update
  // first (the existing edit-variations endpoint handles phase /
  // variationWeights bookkeeping); then sweep changesets that referenced
  // the deleted variation. Not atomic across the two writes — but a
  // partial failure leaves orphan visualChanges that are harmless
  // (the UI filters by current `variations` ids) and re-runnable.
  const deleteVariation = useCallback(
    async (variationId: string) => {
      const newVariations = experiment.variations.filter(
        (v) => v.id !== variationId,
      );
      const newWeights = getEqualWeights(newVariations.length, 4);

      await apiCall(`/experiment/${experiment.id}`, {
        method: "POST",
        body: JSON.stringify({
          variations: newVariations,
          variationWeights: newWeights,
        }),
      });

      // Sweep each changeset that had a row for this variation.
      await Promise.all(
        visualChangesets
          .filter((vc) =>
            vc.visualChanges.some((c) => c.variation === variationId),
          )
          .map((vc) =>
            apiCall(`/visual-changesets/${vc.id}`, {
              method: "PUT",
              body: JSON.stringify({
                ...vc,
                visualChanges: vc.visualChanges.filter(
                  (c) => c.variation !== variationId,
                ),
              }),
            }),
          ),
      );

      mutate?.();
      track("Delete variation", {
        source: "visual-editor-ui",
      });
    },
    [apiCall, experiment, visualChangesets, mutate],
  );

  // Flatten environmentStates into the shape EnvironmentStatesGrid
  // consumes (same shape the prior implementation built). Active =
  // environments with a connection that has visual experiments enabled.
  const envStatesArray = useMemo(() => {
    if (!environmentStates) return [];
    return Object.entries(environmentStates).map(([env, state]) => ({
      env,
      state,
      isActive: state === "active",
      tooltip:
        state === "active"
          ? "An SDK connection in this environment has visual experiments enabled"
          : "No SDK connection in this environment has visual experiments enabled",
    }));
  }, [environmentStates]);

  return (
    <>
      {editingVisualChangeset && mutate ? (
        <VisualChangesetModal
          mode="edit"
          experiment={experiment}
          visualChangeset={editingVisualChangeset}
          mutate={mutate}
          close={() => setEditingVisualChangeset(null)}
          source={"visual-changeset-table"}
        />
      ) : null}

      {editingVisualChange ? (
        <EditDOMMutationsModal
          experiment={experiment}
          visualChange={editingVisualChange.visualChange}
          close={() => setEditingVisualChange(null)}
          onSave={(newVisualChange) =>
            updateVisualChange({
              index: editingVisualChange.visualChangeIndex,
              visualChange: newVisualChange,
              visualChangeset: editingVisualChange.visualChangeset,
            })
          }
        />
      ) : null}

      <Flex className={styles.cards} direction="column">
        {visualChangesets.map((vc) => (
          <UrlCard
            key={vc.id}
            vc={vc}
            experiment={experiment}
            canEdit={canEditVisualChangesets}
            envStatesArray={envStatesArray}
            onEditTargeting={() => {
              setEditingVisualChangeset(vc);
              track("Open visual editor modal", {
                source: "visual-editor-ui",
                action: "edit",
              });
            }}
            onDeleteChangeset={() => deleteVisualChangeset(vc.id)}
            setEditingVisualChange={setEditingVisualChange}
            onDeleteDomMutation={deleteDomMutation}
            onClearGlobal={clearGlobalBlock}
            onDeleteVariation={deleteVariation}
          />
        ))}
      </Flex>
    </>
  );
};
