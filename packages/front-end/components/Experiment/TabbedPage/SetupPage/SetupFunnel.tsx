import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import { ReactNode, useEffect, useState } from "react";
import clsx from "clsx";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "shared/types/experiment";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  PiFadersHorizontal,
  PiImage,
  PiPencilSimple,
  PiPlus,
} from "react-icons/pi";
import ScreenshotUpload from "@/components/EditExperiment/ScreenshotUpload";
import AuthorizedImage from "@/components/AuthorizedImage";
import useOrgSettings from "@/hooks/useOrgSettings";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import Tooltip from "@/ui/Tooltip";
import screenshotUploadStyles from "@/components/EditExperiment/ScreenshotUpload.module.scss";
import styles from "./SetupFunnel.module.scss";

// The pieces of the Setup page's Implementation block, per the design
// (Experiment Page.dc.html, Empty and Partial frames). TrafficAllocationFunnel
// and VariationsTable use these in place of their own cards when rendered on
// the Setup page; everywhere else they're unchanged. Styles and the
// off-scale values are in SetupFunnel.module.scss.
//
// FALLBACK: Radix IconButton, used directly for the pencils and the add
// variation button. @/ui/ has no icon button.

// The same pencil as the rail's Details tab (set in review): ghost, gray
// high contrast, round, size 2 with a 14px icon. Radix's negative margins
// keep the bigger button from taking extra room.
export function EditButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <IconButton
      className={styles.editButton}
      variant="ghost"
      color="gray"
      highContrast
      radius="full"
      size="2"
      onClick={onClick}
      aria-label={label}
    >
      <PiPencilSimple size="14" />
    </IconButton>
  );
}

// Targeting, Population: a title with a pencil on the right
// (shown on hover), then label/value rows.
export function SetupFunnelCard({
  title,
  onEdit,
  action,
  children,
}: {
  title: string;
  onEdit?: (() => void) | null;
  // A control in the pencil's place instead (e.g. Population's
  // SplitPreviewButton).
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Box className={styles.card}>
      <Flex
        justify="between"
        align="center"
        gap="2"
        mb={children ? "2" : "0"}
        style={{ minHeight: 20 }}
      >
        {/* Our 14px field label (the one @/ui/TextField uses: medium,
          semibold), not an uppercase eyebrow (set in review). */}
        <Text as="div" size="md" weight="semibold">
          {title}
        </Text>
        {action || onEdit ? (
          // Nudged up 1px (set in review). A relative offset, so nothing
          // else in the card moves.
          <Box style={{ position: "relative", top: -1 }}>
            {action ?? <EditButton onClick={onEdit!} label={`Edit ${title}`} />}
          </Box>
        ) : null}
      </Flex>
      {/* 4px between rows, 2px under the design's 6px (set in review). */}
      <Flex direction="column" gap="1">
        {children}
      </Flex>
    </Box>
  );
}

// A field label: --slate-11, the same as the rail's Details labels
// (RailLabel in SetupRail.tsx; set in review). OFF THE TEXT TOKENS: Text's
// color prop only takes text-high/mid/low/disabled, so the colour is set on
// a wrapper and Text inherits it. 12px by default; the cards' rows use 14px.
export function SetupLabel({
  children,
  size = "sm",
}: {
  children: ReactNode;
  size?: "sm" | "md";
}) {
  return (
    <Box style={{ color: "var(--slate-11)" }}>
      <Text as="div" size={size}>
        {children}
      </Text>
    </Box>
  );
}

// A label on the left, its value on the right. 14px, labels and values
// alike, set in review (the design has 12px).
export function SetupFunnelRow({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <Flex justify="between" align="baseline" gap="3">
      <SetupLabel size="md">{label}</SetupLabel>
      <Box className={clsx(styles.rowValue, mono && styles.mono)}>
        {mono ? children : <Text size="md">{children}</Text>}
      </Box>
    </Flex>
  );
}

// Population's one control for the traffic modal, in the card header where
// the pencil was (both set in review). Not an edit control (the Included %
// field is one): it promises the slider and the split preview. Revealed like
// the pencil, on hover of the card or keyboard focus. FALLBACK: Radix
// IconButton; @/ui/ has no icon button.
export function SplitPreviewButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip content="Adjust with split preview">
      {/* Styled exactly like the cards' pencils (EditButton): ghost, gray
        high contrast, round, size 2, a 14px regular-weight icon, and the
        same hover reveal (.editButton; set in review). */}
      <IconButton
        className={styles.editButton}
        variant="ghost"
        color="gray"
        highContrast
        radius="full"
        size="2"
        onClick={onClick}
        aria-label="Adjust with split preview"
      >
        <PiFadersHorizontal size="14" />
      </IconButton>
    </Tooltip>
  );
}

// Population's "Included %", edited in place (set in review), as the design
// shows. Writes to the page draft, so Save and Discard cover it. The field
// keeps its own text while typing; anything that isn't a number from 0 to 100
// isn't applied, and leaving the field puts back the last valid value.
function toPercentText(coverage: number): string {
  return String(Math.round(coverage * 10000) / 100);
}

export function CoverageRow({
  coverage,
  onChange,
}: {
  coverage: number;
  onChange: (coverage: number) => void;
}) {
  const [text, setText] = useState(toPercentText(coverage));
  const [focused, setFocused] = useState(false);
  // Follow outside changes (Discard, a save, the traffic modal) unless the
  // field is being edited.
  useEffect(() => {
    if (!focused) setText(toPercentText(coverage));
  }, [coverage, focused]);

  const parsed = text.trim() === "" ? NaN : Number(text);
  const invalid = Number.isNaN(parsed) || parsed < 0 || parsed > 100;

  return (
    <Flex justify="between" align="center" gap="3">
      {/* 14px, the same as the other cards' rows and the field's own
        text. */}
      <SetupLabel size="md">Included %</SetupLabel>
      {/* 72px, the value column's width, so its text lines up with the
        values in the Targeting card above: the column insets its text 9px,
        and the small field puts its text 8px in (border included), so the
        field starts 1px in. */}
      <Box
        style={{
          flex: "0 0 72px",
          width: 72,
          boxSizing: "border-box",
          paddingLeft: 1,
        }}
      >
        <TextField
          // 32px (md, Radix step 2), set in review.
          size="md"
          type="number"
          min={0}
          max={100}
          step="any"
          inputMode="decimal"
          value={text}
          aria-label="Included percent"
          aria-invalid={invalid || undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setText(toPercentText(coverage));
          }}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value.trim() !== "" && n >= 0 && n <= 100) {
              onChange(n / 100);
            }
          }}
        />
      </Box>
    </Flex>
  );
}

// The arrow between two cards. An annotation (the namespace, between
// Targeting and Population) sits over the middle of the line rather than in
// the layout, so the arrow is the same height with it or without it and
// nothing below moves when it appears.
export function SetupConnector({ annotation }: { annotation?: ReactNode }) {
  return (
    <Flex direction="column" align="center" width="100%">
      <div className={styles.connectorWrap}>
        <div className={styles.connector} aria-hidden />
        {annotation ? (
          <div className={styles.connectorAnnotation}>{annotation}</div>
        ) : null}
      </div>
    </Flex>
  );
}

// Targeting, the arrow between them and Population, as one group: the hover
// area that reveals "+ Namespace" (set in review), defined by those three
// elements rather than a region of the panel, whose height varies. As wide
// as the cards (100%, at most 440px) and centred, as they were on their
// own, so wrapping them doesn't move anything.
export function NamespaceHoverGroup({ children }: { children: ReactNode }) {
  return (
    <Flex
      direction="column"
      align="center"
      width="100%"
      className={styles.namespaceHoverGroup}
      style={{ maxWidth: 440 }}
    >
      {children}
    </Flex>
  );
}

// How much of the namespace the experiment's ranges cover, as a whole
// percentage: the ranges' widths added up, not their endpoints (those stay
// in the Edit Namespace modal). Null when it's the whole namespace, where a
// "(100%)" would say nothing about traffic.
function namespaceSharePercent(ranges: [number, number][]): number | null {
  const share = ranges.reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0);
  const percent = Math.round(share * 100);
  return percent >= 100 ? null : percent;
}

// The namespace on the Targeting → Population arrow (set in review; it
// replaces the "Add Namespace" link and the Namespace card).
//
// No namespace: a quiet "+ Namespace", hidden until Targeting, the arrow or
// Population is hovered (NamespaceHoverGroup), or the control has keyboard
// focus; always shown on touch screens. In --slate-11 at regular weight, so
// it's quieter than the Targeting card's pencil (gray-12), which appears on
// the same hover. Set: "Namespace: name (share%)", always shown, styled like
// "Split %".
// Either opens the existing Edit Namespace modal: the empty state is a
// plain button styled like the split pills, and the set state is text with
// the shared pencil beside it (no new button or chip component).
export function NamespaceAnnotation({
  name,
  ranges,
  onEdit,
}: {
  // Empty when no namespace is set.
  name: string;
  ranges: [number, number][];
  onEdit?: (() => void) | null;
}) {
  if (!name) {
    if (!onEdit) return null;
    return (
      <button
        type="button"
        className={clsx(styles.annotationButton, styles.namespaceAdd)}
        onClick={onEdit}
        aria-label="Add namespace"
      >
        {/* --slate-11, set in review. Off the text tokens, so set on a
          wrapper that Text inherits from. */}
        <Box style={{ color: "var(--slate-11)" }}>
          <Text as="div" size="sm">
            <Flex align="center" gap="1">
              <PiPlus size="12" aria-hidden />
              Namespace
            </Flex>
          </Text>
        </Box>
      </button>
    );
  }
  // "Namespace: applications (50%)", or without the percentage when it's
  // the whole namespace (set in review). "Namespace:" says what the name is,
  // since the arrow has no label column like the cards do. It matches
  // "Split %" (12px, main text colour): "Namespace:" semibold, the value
  // after it regular (set in review).
  const percent = namespaceSharePercent(ranges);
  const text = `Namespace: ${name}${percent === null ? "" : ` (${percent}%)`}`;
  // Always one line: anything too long ends in "…", with the full text on
  // hover (set in review).
  const content = (
    <Box minWidth="0">
      <Text as="div" size="sm" weight="semibold" truncate title={text}>
        Namespace:{" "}
        <span className={styles.namespaceValue}>
          {name}
          {percent === null ? null : ` (${percent}%)`}
        </span>
      </Text>
    </Box>
  );
  // Set: plain text, like "Split %", with the shared pencil just after it,
  // shown on hover (set in review). The pencil sits outside the text's box,
  // so the text stays centred on the arrow whether or not it's showing.
  return (
    <span className={clsx(styles.annotationButton, styles.namespaceSet)}>
      {content}
      {onEdit ? (
        <span className={styles.namespaceEdit}>
          <EditButton onClick={onEdit} label={`Edit namespace: ${text}`} />
        </span>
      ) : null}
    </span>
  );
}

// Where a variation column's centre falls, as a CSS left offset, for n equal
// columns with the variation grid's gap between them (16px; see
// VariationsTable's Setup layout, which must match).
function columnCenter(i: number, n: number): string {
  return `calc((100% - ${n - 1} * var(--space-4)) * ${(i + 0.5) / n} + ${i} * var(--space-4))`;
}

// The split, from Population down to the variation cards, as a fork (set in
// review, after the product's own funnel): "Split %" under Population, a line
// across to each variation's column, and a drop into each card with its
// percentage on it (a button to edit the split, when allowed) and an
// arrowhead at the end. A bandit sets its own weights, so it has no pills.
export function SetupSplit({
  variations,
  percentages,
  onEditSplit,
  isBandit,
}: {
  variations: (Variation & { index: number })[];
  percentages: number[] | null;
  onEditSplit?: ((variationId?: string) => void) | null;
  isBandit: boolean;
}) {
  const n = variations.length;
  const showPills = !isBandit && !!percentages;
  return (
    // 8px clear of Population above and of the cards below (set in
    // review).
    <Box mt="2" mb="2">
      {/* The stem and "Split %" stay put, centred under Population, while
        a wide row of variations scrolls beneath them (.stickyVisible; set
        in review). */}
      <div className={styles.stickyVisible}>
        <div className={styles.stem} aria-hidden />
        {showPills ? (
          <>
            <div className={styles.splitLabel}>
              {/* The same as the Environments label: 12px, semibold, main
                text colour (set in review). */}
              <Text size="sm" weight="semibold">
                Split %
              </Text>
            </div>
            <div className={styles.stem} aria-hidden />
          </>
        ) : null}
      </div>
      <div className={styles.fork}>
        {n > 1 ? (
          <div
            className={styles.bus}
            style={{
              left: columnCenter(0, n),
              right: `calc(100% - ${columnCenter(n - 1, n)})`,
            }}
            aria-hidden
          />
        ) : null}
        {variations.map((v, i) => {
          const text = `${(percentages?.[i] ?? 0).toFixed(0)}%`;
          return (
            <div
              key={v.id}
              className={styles.drop}
              style={{ left: columnCenter(i, n) }}
            >
              <div className={styles.dropLine} aria-hidden />
              {showPills ? (
                onEditSplit ? (
                  <button
                    type="button"
                    className={styles.pill}
                    onClick={() => onEditSplit(v.id)}
                    aria-label={`Edit ${v.name} split (${text})`}
                  >
                    {text}
                    {/* Shown on hover or focus (set in review). */}
                    <span className={styles.pillIcon} aria-hidden>
                      <PiPencilSimple size="10" />
                    </span>
                  </button>
                ) : (
                  <span className={styles.pill}>{text}</span>
                )
              ) : null}
              <div className={styles.dropLine} aria-hidden />
              <div className={styles.arrow} aria-hidden />
            </div>
          );
        })}
      </div>
    </Box>
  );
}

// A variation, after the review mockup: a band in its colour across the top
// with its number in a notched tab, then its name (with a pencil) and
// description on the left and a screenshot slot on the right. An empty slot
// uploads a screenshot when clicked; a filled one opens the screenshots.
export function SetupVariationCard({
  v,
  experiment,
  canEdit,
  onEdit,
  mutate,
  openCarousel,
  imageCache,
  dragListeners,
  canUpload: canUploadProp = true,
}: {
  v: Variation & { index: number };
  experiment: ExperimentInterfaceStringDates;
  canEdit: boolean;
  onEdit?: () => void;
  mutate?: () => void;
  openCarousel: (variationId: string, index: number) => void;
  imageCache: Record<string, { url: string; expiresAt: string }>;
  // Drag-to-reorder (set in review): when given, the colour band and the
  // index notch on its edge are the drag handle, and nothing else on the
  // card. No grip icon: a grab cursor, a slight brighten on hover and a
  // "Drag to reorder" tooltip. Without it (e.g. once started) the band is
  // inert: no cursor, no tooltip, nothing.
  dragListeners?: DraggableSyntheticListeners;
  // False hides the image upload while canEdit is true (an unsaved
  // variation can be edited but has nowhere to upload to yet).
  canUpload?: boolean;
}) {
  const { blockFileUploads } = useOrgSettings();
  const screenshots = v.screenshots ?? [];
  const canUpload = canEdit && canUploadProp && !blockFileUploads;

  let thumb: ReactNode;
  if (screenshots.length) {
    thumb = (
      <button
        type="button"
        // With an image, a light outline over its edge (.thumbWithImage).
        className={clsx(styles.thumb, styles.thumbWithImage)}
        onClick={() => openCarousel(v.id, 0)}
        aria-label={`View screenshots for ${v.name} (${screenshots.length})`}
      >
        <AuthorizedImage
          imageCache={imageCache}
          src={screenshots[0].path}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        {/* "+n" for the rest, over the image's bottom-right corner on a
          small white circle (set in review; it was beside the image). */}
        {screenshots.length > 1 ? (
          <span className={styles.thumbCount} aria-hidden>
            +{screenshots.length - 1}
          </span>
        ) : null}
      </button>
    );
  } else if (canUpload) {
    thumb = (
      <ScreenshotUpload
        variation={v.index}
        experiment={experiment.id}
        onSuccess={() => mutate?.()}
      >
        <div
          className={clsx(styles.thumb, styles.thumbUpload)}
          title="Add a screenshot"
          aria-label={`Add a screenshot for ${v.name}`}
        >
          <PiImage size="16" />
        </div>
      </ScreenshotUpload>
    );
  } else {
    // In the same box ScreenshotUpload wraps the upload slot in (its
    // .droparea), so the description beside it lays out the same whether
    // or not the card can upload: it had shifted when an unsaved variation
    // was saved and gained its upload (fixed in review).
    thumb = (
      <div className={screenshotUploadStyles.droparea}>
        <div className={styles.thumb} aria-hidden>
          <PiImage size="16" />
        </div>
      </div>
    );
  }

  const band = (
    <div
      className={clsx(
        styles.cardBand,
        `variation variation${v.index} with-variation-color`,
        dragListeners && styles.dragHandle,
      )}
      aria-hidden
      {...dragListeners}
    />
  );
  const tab = (
    <div
      className={clsx(
        styles.cardTab,
        styles[`tabColor${v.index % 9}`],
        dragListeners && styles.dragHandle,
      )}
      aria-hidden
      {...dragListeners}
    >
      <span className={styles.cardTabNumber}>{v.index}</span>
    </div>
  );

  return (
    <Box className={styles.variationCard}>
      {dragListeners ? (
        <>
          {/* After 2 seconds of hover (set in review), so it doesn't pop
            up every time the pointer crosses a card. */}
          <Tooltip content="Drag to reorder" delayDuration={2000}>
            {band}
          </Tooltip>
          <Tooltip content="Drag to reorder" delayDuration={2000}>
            {tab}
          </Tooltip>
        </>
      ) : (
        <>
          {band}
          {tab}
        </>
      )}
      {/* The name, right under the number, across the full width with the
        pencil at the end (set in review). */}
      <Flex align="center" gap="2" style={{ minHeight: 20 }}>
        <Box minWidth="0" flexGrow="1">
          {/* The same as the Targeting and Population titles: 14px,
            semibold, in the main text colour (set in review). */}
          <Text as="div" size="md" weight="semibold" truncate>
            {v.name}
          </Text>
        </Box>
        {canEdit && onEdit ? (
          // 4px up from centred on the name (set in review).
          <span
            style={{ display: "inline-flex", position: "relative", top: -4 }}
          >
            <EditButton onClick={onEdit} label={`Edit ${v.name}`} />
          </span>
        ) : null}
      </Flex>
      {/* 12px below the name, the description with the screenshot slot on
        the right, centred on each other: the slot lines up with the
        description only, not the name (set in review). */}
      <Flex align="center" gap="3" mt="3">
        {/* An entered description in the page text colour, the same as the
          rail's Details values; "No description" in --slate-10, the design's
          colour for it (set in review). Off the text tokens, so set on a
          wrapper that Text inherits from. Wraps rather than truncating. */}
        <Box
          minWidth="0"
          flexGrow="1"
          style={v.description ? undefined : { color: "var(--slate-10)" }}
        >
          <Text as="div" size="sm" overflowWrap="anywhere">
            {v.description || "No description"}
          </Text>
        </Box>
        {/* Its own fixed-size box at the right edge. ScreenshotUpload's
          drop area is width: 100%, so unwrapped it took half the row. */}
        <Box flexShrink="0">{thumb}</Box>
      </Flex>
    </Box>
  );
}

// The coloured dot at the start of a value field.
export function ValueDot({ index }: { index: number }) {
  return (
    <span
      className={clsx(
        styles.valueDot,
        `variation variation${index} with-variation-color`,
      )}
      aria-hidden
    />
  );
}
