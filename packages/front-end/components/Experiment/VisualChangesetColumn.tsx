import React, { useMemo, useState } from "react";
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
  PiImageBold,
  PiPaintBrushBold,
  PiTextTBold,
  PiTrashBold,
} from "react-icons/pi";
import track from "@/services/track";
import { appendQueryParamsToURL } from "@/services/utils";
import VisualChangesetModal from "@/components/Experiment/VisualChangesetModal";
import EditDOMMutationsModal from "@/components/Experiment/EditDOMMutationsModal";
import { experimentVisualChangesetOwner } from "@/components/Experiment/visualChangesetOwner";
import { SdkConnectionEnvironmentsPopover } from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import {
  ColumnCell,
  ColumnFooter,
  ColumnHeader,
  ColumnLayout,
  HeaderText,
  ShownVariation,
  StagedNote,
} from "@/components/Experiment/TabbedPage/ImplementationColumn";
import {
  ShownVisualChangeset,
  VisualTargeting,
} from "@/components/Experiment/TabbedPage/linkedChangesDraft";
import { useExperimentEdits } from "@/components/Experiment/TabbedPage/ExperimentEdits";
import OpenVisualEditorLink from "@/components/OpenVisualEditorLink";
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
import { withoutProtocol } from "./LinkedChanges/redirectDestination";
import styles from "./VisualChangesetColumn.module.scss";

// Stored editor URLs often omit a protocol, which links treat as app-relative.
function normalizeVisualEditorUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (!trimmed.match(/^http(s)?:/)) {
    return `http://${trimmed}`;
  }
  return trimmed;
}

// Each DOM mutation, plus non-empty CSS and JS.
function visualChangeCount(change: VisualChange): number {
  return (
    (change.css?.trim() ? 1 : 0) +
    (change.js?.trim() ? 1 : 0) +
    (change.domMutations?.length || 0)
  );
}

// The editor's Global CSS often arrives minified; this only splits on
// `{`, `}` and `;` outside string literals.
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

// Consumed by `.typeTile` and `.afterChip`; inline rather than five
// near-identical classes.
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

function ChangeRow({
  h,
  onDelete,
}: {
  h: Humanized;
  // Stages the removal; omitted where the row is read-only.
  onDelete?: () => void;
}) {
  const [showCode, setShowCode] = useState(false);
  const [imageError, setImageError] = useState(false);
  // Only while open; most rows stay closed.
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
            onClick={onDelete}
            title="Delete this change"
            aria-label="Delete this change"
          >
            <PiTrashBold size={13} />
          </button>
        )}
      </Flex>
      {showCode && (
        <Box className={styles.codePanel}>
          {/* A selector isn't human-readable, so it sits with the raw values. */}
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

type ChangeListRow = {
  key: string;
  humanized: Humanized;
  onDelete?: () => void;
};

// Stages the change with one row removed; `kind` names what was removed.
type StageRemoval = (
  next: VisualChange,
  kind: "mutation" | "globalCss" | "globalJs",
) => void;

// One row per DOM mutation, then the global CSS and JS. Read-only without
// `stage`.
function changeRowsFor(
  change: VisualChange | undefined,
  stage: StageRemoval | null,
): ChangeListRow[] {
  if (!change) return [];
  const rows: ChangeListRow[] = (change.domMutations || []).map((m, i) => ({
    key: `mut:${m.selector}|${m.attribute}|${m.action}|${i}`,
    humanized: humanizeMutation(m),
    onDelete: stage
      ? () =>
          stage(
            {
              ...change,
              domMutations: change.domMutations.filter((_, j) => j !== i),
            },
            "mutation",
          )
      : undefined,
  }));
  (["css", "js"] as const).forEach((kind) => {
    const value = change[kind];
    if (!value?.trim()) return;
    rows.push({
      key: `global:${kind}`,
      humanized: humanizeGlobalBlock({ kind, value }),
      onDelete: stage
        ? () =>
            stage(
              { ...change, [kind]: "" },
              kind === "css" ? "globalCss" : "globalJs",
            )
        : undefined,
    });
  });
  return rows;
}

function MorePatterns({
  patterns,
}: {
  patterns: VisualChangesetInterface["urlPatterns"];
}) {
  if (!patterns.length) return null;
  return (
    <Tooltip
      content={
        <Flex direction="column" gap="1">
          {patterns.map((p, i) => (
            <span key={i}>
              {p.include ? "" : "Except "}
              {p.pattern}
            </span>
          ))}
        </Flex>
      }
    >
      <span className={styles.ruleChip}>
        <Text size="sm" color="text-low">
          +{patterns.length}
        </Text>
      </span>
    </Tooltip>
  );
}

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
    <Flex as="span" align="center" gap="2" minWidth="0" wrap="wrap">
      <Text color="text-low">
        {includes.length ? "Applies to" : "Applies everywhere except"}
      </Text>
      <RuleChip rule={first} />
      <MorePatterns patterns={rest} />
    </Flex>
  );
}

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
  onEdit: (() => void) | null;
  close: () => void;
}) {
  // Previews force the variation by its saved index; a staged-only variation
  // has none yet.
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

export default function VisualChangesetColumn({
  layout,
  shown,
  experiment,
  canEdit,
  lockedReason = null,
  canLaunch,
  environmentStates,
  onStageTargeting,
  onStageChange,
  onRemove,
  onUndo,
}: {
  layout: ColumnLayout;
  shown: ShownVisualChangeset;
  experiment: ExperimentInterfaceStringDates;
  canEdit: boolean;
  lockedReason?: string | null;
  canLaunch: boolean;
  environmentStates?: LinkedChangeEnvStates;
  onStageTargeting: (
    stored: VisualChangesetInterface,
    targeting: VisualTargeting,
  ) => void;
  onStageChange: (
    stored: VisualChangesetInterface,
    change: VisualChange,
  ) => void;
  onRemove: (id: string) => void;
  onUndo: (id: string) => void;
}) {
  const { variations } = layout;
  const edits = useExperimentEdits();
  const vc = shown.changeset;
  const canChange = canEdit && !lockedReason;
  const [viewing, setViewing] = useState<string | null>(null);
  const [editingTargeting, setEditingTargeting] = useState(false);
  const [editingVisualChange, setEditingVisualChange] =
    useState<VisualChange | null>(null);

  const rowsByVariation = useMemo(() => {
    const stage: StageRemoval | null = canChange
      ? (next, kind) => {
          onStageChange(shown.stored, next);
          track("Delete visual change", { source: "visual-editor-ui", kind });
        }
      : null;
    return new Map(
      variations.map((v) => [
        v.id,
        changeRowsFor(
          shown.changeset.visualChanges.find((c) => c.variation === v.id),
          stage,
        ),
      ]),
    );
  }, [variations, shown, canChange, onStageChange]);
  const hasChanges = vc.visualChanges.some((c) => visualChangeCount(c) > 0);
  const viewed = variations.find((v) => v.id === viewing);
  const viewedChange = viewed
    ? (vc.visualChanges.find((c) => c.variation === viewed.id) ?? null)
    : null;
  const releasing =
    experiment.status === "stopped" &&
    !!experiment.releasedVariationId &&
    !experiment.excludeFromPayload;
  const stagedNote =
    experiment.status === "running"
      ? "Serves to this experiment's traffic as soon as you save."
      : releasing
        ? "Changes to the released variation serve to all traffic as soon as you save."
        : "Changed when you save.";
  const launchable = canEdit && canLaunch;
  const firstInclude = vc.urlPatterns?.find((p) => p.include);
  const target = firstInclude
    ? firstInclude.type === "regex"
      ? firstInclude.pattern
      : withoutProtocol(firstInclude.pattern)
    : withoutProtocol(vc.editorUrl);
  const menu = canEdit
    ? [
        <DropdownMenuItem
          key="targeting"
          disabled={!!lockedReason}
          tooltip={lockedReason ?? undefined}
          onClick={() => {
            setEditingTargeting(true);
            track("Open visual editor modal", {
              source: "visual-editor-ui",
              action: "edit",
            });
          }}
        >
          Edit URL targeting
        </DropdownMenuItem>,
        <DropdownMenuSeparator key="separator" />,
        <DropdownMenuItem
          key="remove"
          color="red"
          disabled={!!lockedReason}
          tooltip={lockedReason ?? undefined}
          onClick={() => {
            onRemove(shown.stored.id);
            track("Delete visual changeset", { source: "visual-editor-ui" });
          }}
        >
          Remove from experiment
        </DropdownMenuItem>,
      ]
    : [];

  return (
    <>
      {editingTargeting ? (
        <VisualChangesetModal
          mode="edit"
          visualChangeset={vc}
          stage={(targeting) => onStageTargeting(shown.stored, targeting)}
          close={() => setEditingTargeting(false)}
          source="visual-changeset-table"
        />
      ) : null}
      {editingVisualChange ? (
        <EditDOMMutationsModal
          owner={experimentVisualChangesetOwner(experiment)}
          visualChange={editingVisualChange}
          close={() => setEditingVisualChange(null)}
          onSave={(newVisualChange) => {
            onStageChange(shown.stored, newVisualChange);
            track("Edit visual change", { source: "visual-editor-ui" });
          }}
        />
      ) : null}
      {viewed ? (
        <VariationChangesModal
          vc={vc}
          experiment={experiment}
          variation={viewed}
          rows={rowsByVariation.get(viewed.id) ?? []}
          onEdit={
            canChange && viewedChange
              ? () => {
                  setViewing(null);
                  setEditingVisualChange(viewedChange);
                }
              : null
          }
          close={() => setViewing(null)}
        />
      ) : null}

      <ColumnHeader
        layout={layout}
        title={
          <>
            <HeaderText>Visual changes</HeaderText>
            {target ? (
              <Flex minWidth="0">
                <HeaderText muted>(</HeaderText>
                <HeaderText muted truncate>
                  {target}
                </HeaderText>
                <HeaderText muted>)</HeaderText>
              </Flex>
            ) : null}
          </>
        }
        kind={
          launchable ? (
            <OpenVisualEditorLink
              visualChangeset={vc}
              size="sm"
              beforeLeave={edits?.allowUnload}
              button="Open editor"
            />
          ) : (
            "AI Visual Editor"
          )
        }
        problem={
          hasChanges ? null : { text: "No changes yet", status: "warning" }
        }
        menu={menu}
        menuLabel="AI Visual Editor changes actions"
      />
      {variations.map((v, i) => {
        const rows = rowsByVariation.get(v.id) ?? [];
        const [first] = rows;
        return (
          <ColumnCell key={v.id} layout={layout} row={i}>
            <button
              type="button"
              className={styles.changesToggle}
              onClick={() => setViewing(v.id)}
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
          </ColumnCell>
        );
      })}
      <ColumnFooter
        layout={layout}
        start={
          environmentStates && Object.keys(environmentStates).length ? (
            <SdkConnectionEnvironmentsPopover
              environmentStates={environmentStates}
              kind="Visual Editor"
              project={experiment.project ?? ""}
            />
          ) : null
        }
      >
        {shown.staged ? (
          <StagedNote onUndo={() => onUndo(shown.stored.id)}>
            {stagedNote}
          </StagedNote>
        ) : null}
      </ColumnFooter>
    </>
  );
}
