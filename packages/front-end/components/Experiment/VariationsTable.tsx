import {
  ExperimentInterfaceStringDates,
  Variation,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FC, ReactNode, useState, useRef, useCallback, useEffect } from "react";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import {
  PiCameraLight,
  PiCameraPlusLight,
  PiPencilSimpleFill,
  PiPlus,
  PiPlusCircle,
  PiUploadSimple,
} from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { trafficSplitPercentages } from "@/services/utils";
import Carousel from "@/components/Carousel";
import ScreenshotUpload from "@/components/EditExperiment/ScreenshotUpload";
import AuthorizedImage from "@/components/AuthorizedImage";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import ExperimentCarouselModal from "@/components/Experiment/ExperimentCarouselModal";
import useOrgSettings from "@/hooks/useOrgSettings";
import Metadata from "@/ui/Metadata";
import VariationLabel from "@/ui/VariationLabel";
import { SetupVariationCard } from "@/components/Experiment/TabbedPage/SetupPage/SetupFunnel";
import setupFunnelStyles from "@/components/Experiment/TabbedPage/SetupPage/SetupFunnel.module.scss";
import SortableVariationsList from "@/components/Features/SortableVariationsList";

export const MAX_VARIATION_WIDTH = 336;

// Floor height for the "no image" placeholder when no variation in the row has
// a screenshot; otherwise it grows to match the row height.
const NO_IMAGE_MIN_HEIGHT = 72;
const MAX_IMAGE_HEIGHT = 150;

// Radix Themes breakpoints (px), mirroring `@radix-ui/themes` `--xs`/`--sm`.
const XS_BREAKPOINT = 520;
const SM_BREAKPOINT = 768;

export const getVariationGridColumns = (cols: number) => ({
  initial: `minmax(0, ${MAX_VARIATION_WIDTH}px)`,
  xs: `repeat(${Math.min(cols, 2)}, minmax(0, ${MAX_VARIATION_WIDTH}px))`,
  sm: `repeat(${cols}, minmax(0, ${MAX_VARIATION_WIDTH}px))`,
  md: `repeat(${cols}, minmax(0, ${MAX_VARIATION_WIDTH}px))`,
});

function useMaxColsForViewport(): number {
  const [maxCols, setMaxCols] = useState(3);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const xs = window.matchMedia(`(min-width: ${XS_BREAKPOINT}px)`);
    const sm = window.matchMedia(`(min-width: ${SM_BREAKPOINT}px)`);
    const update = () => setMaxCols(sm.matches ? 3 : xs.matches ? 2 : 1);
    update();
    xs.addEventListener("change", update);
    sm.addEventListener("change", update);
    return () => {
      xs.removeEventListener("change", update);
      sm.removeEventListener("change", update);
    };
  }, []);
  return maxCols;
}

const imageCache = {};

const ScreenshotCarousel: FC<{
  variation: Variation;
  maxChildHeight?: number;
  onClick?: (i: number) => void;
  isPublic?: boolean;
  shareUid?: string;
  shareType?: "experiment" | "report";
}> = ({
  variation,
  maxChildHeight,
  onClick,
  isPublic = false,
  shareUid,
  shareType = "experiment",
}) => {
  const [allowClick, setAllowClick] = useState(true);
  const hasErrorRef = useRef(false);

  const handleError = useCallback(
    (msg: string) => {
      // Only update state if we haven't already set the error
      if (!hasErrorRef.current) {
        hasErrorRef.current = true;
        // Use setTimeout to defer the state update to avoid setState during render
        setTimeout(() => {
          setAllowClick(false);
        }, 0);
      }

      return (
        <Flex
          title={msg}
          align="center"
          justify="center"
          className="appbox mb-0"
          width="100%"
          style={{
            backgroundColor: "var(--slate-a3)",
            height: maxChildHeight + "px",
            width: "100%",
            color: "var(--slate-a9)",
          }}
        >
          <Box>
            <PiCameraLight />
          </Box>
        </Flex>
      );
    },
    [maxChildHeight],
  );

  return (
    <Carousel
      onClick={(i) => {
        if (allowClick && onClick) {
          onClick(i);
        }
      }}
      maxChildHeight={maxChildHeight}
    >
      {variation.screenshots.map((s) => (
        <AuthorizedImage
          imageCache={imageCache}
          className="experiment-image"
          src={s.path}
          key={s.path}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
          onErrorMsg={handleError}
          isPublic={isPublic}
          shareUid={shareUid}
          shareType={shareType}
        />
      ))}
    </Carousel>
  );
};

interface Props {
  experiment: ExperimentInterfaceStringDates;
  variationsList?: string[];
  canEditExperiment: boolean;
  // for some experiments, screenshots don't make sense - this is for a future state where you can mark exp as such.
  allowImages?: boolean;
  mutate?: () => void;
  noMargin?: boolean;
  isPublic?: boolean;
  shareUid?: string;
  shareType?: "experiment" | "report";
  onEditMetadata?: (variationIndex: number) => void;
  onAddVariation?: () => void;
  onEditTraffic?: (variationId?: string) => void;
  // When true, the grid is centered and capped at 3 columns.
  centered?: boolean;
  // An extra row below the cards, one cell per variation, laid out on the
  // same grid so each cell sits in its card's column. Optional and additive:
  // callers that pass nothing render exactly as before. Used by the
  // redesigned Setup page's inline Values row.
  variationRow?: VariationRow;
  // "setup": the redesigned Setup page's layout (see
  // TabbedPage/SetupPage/SetupFunnel.tsx): every variation in one row of
  // equal columns, compact cards, and the add button in the row's right
  // gutter. Optional and additive, like variationRow.
  layout?: "default" | "setup";
  // Setup layout only: drag a card's colour band to reorder the variations
  // (set in review; replaces the Edit Traffic & Variations modal's
  // reordering). onReorder gets the new order (variation ids) for the
  // caller's draft, which the page's Save commits; the caller passes it only
  // before the experiment starts. variationOrder shows that draft order.
  variationOrder?: string[];
  onReorder?: (order: string[]) => void;
  // Setup layout only: variations added in the caller's draft and not
  // saved yet, shown after the saved ones. Until saved, their cards have no
  // pencil or image upload (both act on the saved experiment).
  extraVariations?: Variation[];
  // Setup layout only: the split bar above the cards (SetupSplit), drawn in
  // the same scrolling row so its pills stay over their cards.
  splitRow?: ReactNode;
  // Setup layout only: names and descriptions from the caller's draft, by
  // variation id, shown before they're saved.
  variationEdits?: Record<string, { name: string; description: string }>;
  // Setup layout only: the card's pencil opens that variation's own modal
  // (set in review), unsaved variations included, instead of the traffic or
  // metadata modal.
  onEditVariation?: (variationId: string) => void;
}

export interface VariationRow {
  // Shown above the cells, full width (e.g. an eyebrow and a type picker).
  header?: ReactNode;
  renderCell: (variationId: string) => ReactNode;
}

function AddVariationButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton
      variant="ghost"
      color="violet"
      radius="full"
      onClick={() => onClick()}
      aria-label="Add variation"
    >
      <PiPlusCircle size="15" />
    </IconButton>
  );
}

function NoImageBox({ canEdit }: { canEdit?: boolean }) {
  return (
    <Flex
      align="center"
      justify="center"
      className="appbox mb-0"
      width="100%"
      flexGrow="1"
      style={{
        backgroundColor: "var(--black-a2)",
        height: "100%",
        minHeight: NO_IMAGE_MIN_HEIGHT + "px",
        color: "var(--slate-8)",
        border: "none",
      }}
    >
      <Box>
        {canEdit ? (
          <PiCameraPlusLight size="32px" />
        ) : (
          <PiCameraLight size="32px" />
        )}
      </Box>
    </Flex>
  );
}

export function VariationBox({
  i,
  v,
  experiment,
  showDescription = true,
  showIds,
  showNoImage = true,
  height = 200,
  canEdit,
  allowImages = true,
  openCarousel,
  mutate,
  percent,
  showSplit,
  minWidth,
  isPublic = false,
  shareUid,
  shareType = "experiment",
  onEditMetadata,
  onEditTraffic,
  capWidth = false,
}: {
  i: number;
  v: Variation;
  experiment: Pick<ExperimentInterfaceStringDates, "id" | "status" | "type">;
  showDescription?: boolean;
  showIds?: boolean;
  showNoImage?: boolean;
  height?: number;
  canEdit?: boolean;
  allowImages?: boolean;
  openCarousel?: (variationId: string, index: number) => void;
  mutate?: () => void;
  percent?: number;
  showSplit?: boolean;
  minWidth?: string | number;
  isPublic?: boolean;
  shareUid?: string;
  shareType?: "experiment" | "report";
  onEditMetadata?: (variationIndex: number) => void;
  onEditTraffic?: (variationId?: string) => void;
  capWidth?: boolean;
}) {
  const { blockFileUploads } = useOrgSettings();
  const isBandit = experiment.type === "multi-armed-bandit";
  const shouldShowSplit = showSplit ?? !isBandit;

  return (
    <Box
      key={i}
      p="5"
      pb="3"
      className="appbox mb-0 position-relative variation"
      style={{
        minWidth,
        maxWidth: capWidth ? MAX_VARIATION_WIDTH + "px" : undefined,
        // Fill the grid-item wrapper so all cards in a row share the same height.
        height: "100%",
      }}
    >
      <Box
        className={`variation variation${i} with-variation-color`}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          height: "6px",
        }}
      />
      <Flex direction="column" height="100%">
        <Box>
          <Flex gap="2" align="center" justify="between">
            <Box minWidth="0" flexGrow="1">
              <VariationLabel number={i} name={v.name} size="lg" />
            </Box>
            {canEdit && onEditMetadata && onEditTraffic ? (
              <IconButton
                variant="ghost"
                size="1"
                color="violet"
                onClick={() => {
                  if (experiment.status === "running") {
                    onEditMetadata(i);
                  } else {
                    onEditTraffic(v.id);
                  }
                }}
                aria-label="Edit variation"
              >
                <PiPencilSimpleFill size="15" />
              </IconButton>
            ) : null}
          </Flex>
        </Box>
        {allowImages && (
          <Box
            mt={showNoImage ? "2" : "0"}
            flexGrow="1"
            style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
          >
            {v.screenshots.length > 0 ? (
              <ScreenshotCarousel
                key={i}
                variation={v}
                maxChildHeight={height}
                onClick={(j) => {
                  if (!openCarousel) return;
                  openCarousel(v.id, j);
                }}
                isPublic={isPublic}
                shareUid={shareUid}
                shareType={shareType}
              />
            ) : !showNoImage ? null : canEdit && !blockFileUploads ? (
              <ScreenshotUpload
                variation={i}
                experiment={experiment.id}
                onSuccess={() => mutate?.()}
              >
                <NoImageBox canEdit={canEdit} />
              </ScreenshotUpload>
            ) : (
              <NoImageBox canEdit={false} />
            )}
          </Box>
        )}
        <Box mt="2">
          {showDescription && v.description ? (
            <Box mb="2">{v.description}</Box>
          ) : null}
          {showIds ? <code className="small">ID: {v.key}</code> : null}
          <Flex align="center" justify="between">
            <Box>
              {shouldShowSplit && percent !== undefined ? (
                <Metadata
                  label="Split"
                  value={`${percent.toFixed(0)}%`}
                  size="sm"
                />
              ) : null}
            </Box>
            {allowImages && (
              <Flex align="center" justify="end" gap="2">
                {canEdit && !blockFileUploads && (
                  <ScreenshotUpload
                    variation={i}
                    experiment={experiment.id}
                    onSuccess={() => mutate?.()}
                    noDrag
                  >
                    <Link>
                      <Flex align="center" gap="1">
                        <PiUploadSimple size="15" />
                        <Text size="sm" weight="semibold">
                          Image
                        </Text>
                      </Flex>
                    </Link>
                  </ScreenshotUpload>
                )}
                {v.screenshots.length > 0 ? (
                  <Text color="text-mid" size="sm" whiteSpace="nowrap">
                    {v.screenshots.length} image
                    {v.screenshots.length > 1 ? "s" : ""}
                  </Text>
                ) : null}
              </Flex>
            )}
          </Flex>
        </Box>
      </Flex>
    </Box>
  );
}

// The Setup cards' grid, inside SortableVariationsList when reordering is
// allowed, or as-is when it isn't.
function MaybeSortable({
  enabled,
  variations,
  onSort,
  children,
}: {
  enabled: boolean;
  variations: (Variation & { value: string })[];
  onSort: (sorted: { id: string }[]) => void;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <SortableVariationsList
      variations={variations}
      // Only the new order: the move itself (and renumbering default keys)
      // happens on save, in the Setup page.
      setVariations={(sorted) => onSort(sorted)}
      sortingStrategy="rect"
      activationDistance={4}
    >
      {children}
    </SortableVariationsList>
  );
}

// One reorderable Setup card's cell: it moves with the drag, and hands the
// drag listeners to the card, which puts them on its colour band and index
// notch only (see SetupVariationCard).
// How a card is moving mid-drag, so the cell below it in the Values row
// can move the same way (set in review): the dragged card's value travels
// with it, and the others shift with theirs.
type CellMotion = {
  transform: string | undefined;
  transition: string | undefined;
  dragging: boolean;
};

function SortableSetupCell({
  id,
  onMotion,
  children,
}: {
  id: string;
  onMotion: (id: string, motion: CellMotion | null) => void;
  children: (dragListeners: DraggableSyntheticListeners) => ReactNode;
}) {
  const { setNodeRef, transform, transition, listeners, isDragging } =
    useSortable({ id });
  const translate = CSS.Translate.toString(transform);
  useEffect(() => {
    onMotion(
      id,
      translate || isDragging
        ? { transform: translate, transition, dragging: isDragging }
        : null,
    );
  }, [id, translate, transition, isDragging, onMotion]);
  return (
    <Box
      ref={setNodeRef}
      height="100%"
      minWidth="0"
      className={isDragging ? setupFunnelStyles.dragging : undefined}
      style={{
        position: "relative",
        // Translate only: the cards differ in height, and a scale would
        // stretch them.
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 1 : undefined,
      }}
    >
      {children(listeners)}
    </Box>
  );
}

const VariationsTable: FC<Props> = ({
  experiment,
  variationsList,
  canEditExperiment,
  allowImages = true,
  noMargin = false,
  mutate,
  isPublic = false,
  shareUid,
  shareType = "experiment",
  onEditMetadata,
  onAddVariation,
  onEditTraffic,
  centered = false,
  variationRow,
  layout = "default",
  variationOrder,
  onReorder,
  extraVariations = [],
  splitRow,
  variationEdits,
  onEditVariation,
}) => {
  const { apiCall } = useAuth();
  const phaseVariations = getLatestPhaseVariations(experiment);
  const latestVariations = [
    ...phaseVariations,
    ...extraVariations.map((v, i) => ({
      ...v,
      index: phaseVariations.length + i,
    })),
  ].map((v) =>
    variationEdits?.[v.id] ? { ...v, ...variationEdits[v.id] } : v,
  );
  const unsavedIds = new Set(extraVariations.map((v) => v.id));
  // In the caller's draft order, if any (an unsaved reorder); the index is
  // the position.
  const variations = variationOrder
    ? variationOrder.flatMap((id, i) => {
        const v = latestVariations.find((lv) => lv.id === id);
        return v ? [{ ...v, index: i }] : [];
      })
    : latestVariations;
  const phases = experiment.phases || [];
  const lastPhaseIndex = phases.length - 1;
  const lastPhase = phases[lastPhaseIndex];
  const weights = lastPhase?.variationWeights ?? null;
  const percentages =
    (weights?.length || 0) > 0 ? trafficSplitPercentages(weights) : null;
  const [openCarousel, setOpenCarousel] = useState<{
    variationId: string;
    index: number;
  } | null>(null);

  const hasUniqueIDs = variations.some((v, i) => v.key !== i + "");
  const someVariationHasImage = variations.some(
    (v) => v.screenshots.length > 0,
  );

  const cols = centered
    ? Math.min(variations.length, 3)
    : variations.length > 4
      ? 4
      : variations.length;
  const gap = "4";

  const maxColsForViewport = useMaxColsForViewport();
  const fullLastRow =
    maxColsForViewport > 0 && variations.length % maxColsForViewport === 0;
  const lastIndex = variations.length - 1;

  const isSetup = layout === "setup";
  const canReorder = isSetup && !!onReorder;
  // Each card's movement mid-drag, keyed by variation id, mirrored onto the
  // Values row below (see CellMotion).
  const [cellMotion, setCellMotion] = useState<Record<string, CellMotion>>({});
  const setCellMotionFor = useCallback(
    (id: string, motion: CellMotion | null) => {
      setCellMotion((prev) => {
        if (!motion) {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        }
        const cur = prev[id];
        if (
          cur &&
          cur.transform === motion.transform &&
          cur.transition === motion.transition &&
          cur.dragging === motion.dragging
        )
          return prev;
        return { ...prev, [id]: motion };
      });
    },
    [],
  );

  // Shared by the cards and the optional variationRow, so the row's cells
  // land in the same columns as the cards above them.
  const gridLayout = isSetup
    ? { columns: `repeat(${variations.length}, minmax(0, 1fr))` }
    : centered
      ? { justify: "center" as const, columns: getVariationGridColumns(cols) }
      : {
          columns: {
            initial: "1",
            xs: "2",
            sm: cols === 2 ? "2" : "3",
            md: cols.toString(),
          },
        };

  // More than three variations in the Setup layout: each column keeps a
  // third of the row's width and the row scrolls sideways to the rest (set
  // in review). The split bar, the cards and the Values row scroll as one,
  // in content as wide as all the columns, so they stay aligned.
  const SETUP_VISIBLE_COLUMNS = 3;
  const scrolls = isSetup && variations.length > SETUP_VISIBLE_COLUMNS;
  const n = variations.length;
  // Where the cards' vertical centre is, for the "+" outside the scroll.
  const cardsRef = useRef<HTMLDivElement>(null);
  const [plusTop, setPlusTop] = useState<number | null>(null);
  useEffect(() => {
    const el = cardsRef.current;
    if (!scrolls || !el) return;
    const measure = () => setPlusTop(el.offsetTop + el.offsetHeight / 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrolls]);
  const scrollContentWidth = `calc((100% - ${SETUP_VISIBLE_COLUMNS - 1} * var(--space-4)) / ${SETUP_VISIBLE_COLUMNS} * ${n} + ${n - 1} * var(--space-4))`;

  return (
    <Box
      mx={noMargin ? "0" : "4"}
      style={scrolls ? { position: "relative" } : undefined}
    >
      {scrolls && onAddVariation && plusTop !== null ? (
        // While the row scrolls, the "+" stays in its usual place (set in
        // review): outside the scrolling row, in the gutter 12px to its
        // right, centred on the cards (measured, as the split bar sits above
        // them and the Values row below). FALLBACK: Radix IconButton; @/ui/
        // has no icon button.
        <Box
          style={{
            position: "absolute",
            left: "calc(100% + var(--space-3))",
            top: plusTop,
            transform: "translateY(-50%)",
            zIndex: 1,
          }}
        >
          <IconButton
            variant="outline"
            color="gray"
            size="2"
            onClick={() => onAddVariation()}
            aria-label="Add variation"
            title="Add variation"
          >
            <PiPlus size="14" />
          </IconButton>
        </Box>
      ) : null}
      <Box
        className={scrolls ? setupFunnelStyles.variationScroller : undefined}
      >
        <Box
          style={
            scrolls
              ? ({
                  width: scrollContentWidth,
                  // The scroll box's visible width, for what stays put while
                  // the row scrolls (.stickyVisible): three columns and their
                  // gaps, from this content's width.
                  "--setup-visible-width": `calc((100% - ${n - 1} * var(--space-4)) * ${SETUP_VISIBLE_COLUMNS} / ${n} + ${SETUP_VISIBLE_COLUMNS - 1} * var(--space-4))`,
                } as React.CSSProperties)
              : undefined
          }
        >
          {splitRow}
          {/* The cards, wrapped for drag-to-reorder when it's allowed:
        SortableVariationsList (as the modal uses), with a 4px threshold so a
        click on the band that drifts a pixel isn't a reorder. */}
          {/* Positioned against the whole row, so the "+" stays put while a
        card is dragged (fixed in review; it was in the last card's cell and
        moved with it). */}
          <Box
            ref={cardsRef}
            style={isSetup ? { position: "relative" } : undefined}
          >
            <MaybeSortable
              enabled={canReorder}
              variations={variations.map((v) => ({ ...v, value: v.key }))}
              onSort={(sorted) => onReorder?.(sorted.map((v) => v.id))}
            >
              <Grid
                // 16px in the Setup layout (being tried in review; was 12px).
                // SetupSplit places its pills over the columns assuming this gap
                // (columnCenter in SetupFunnel.tsx), so the two change together.
                gap={isSetup ? "4" : gap}
                style={{ gridAutoRows: "1fr" }}
                {...gridLayout}
              >
                {variations.map((v, i) => {
                  if (variationsList && !variationsList.includes(v.id))
                    return null;
                  if (isSetup) {
                    // dragListeners: the drag handle's listeners when reorderable.
                    const card = (
                      dragListeners?: DraggableSyntheticListeners,
                    ) => (
                      <SetupVariationCard
                        v={v}
                        experiment={experiment}
                        canEdit={
                          canEditExperiment &&
                          (!!onEditVariation || !unsavedIds.has(v.id))
                        }
                        // Images only once saved: the uploader saves to the
                        // experiment.
                        canUpload={!unsavedIds.has(v.id)}
                        onEdit={
                          onEditVariation
                            ? () => onEditVariation(v.id)
                            : !unsavedIds.has(v.id) &&
                                onEditMetadata &&
                                onEditTraffic
                              ? () =>
                                  experiment.status === "running"
                                    ? onEditMetadata(v.index)
                                    : onEditTraffic(v.id)
                              : undefined
                        }
                        mutate={mutate}
                        openCarousel={(variationId, index) =>
                          setOpenCarousel({ variationId, index })
                        }
                        imageCache={imageCache}
                        dragListeners={dragListeners}
                      />
                    );
                    if (canReorder) {
                      return (
                        <SortableSetupCell
                          key={v.id}
                          id={v.id}
                          onMotion={setCellMotionFor}
                        >
                          {(dragListeners) => card(dragListeners)}
                        </SortableSetupCell>
                      );
                    }
                    return (
                      <Box
                        key={v.id}
                        height="100%"
                        minWidth="0"
                        style={{ position: "relative" }}
                      >
                        {card()}
                      </Box>
                    );
                  }
                  const box = (
                    <VariationBox
                      i={v.index}
                      v={v}
                      experiment={experiment}
                      showIds={hasUniqueIDs}
                      height={MAX_IMAGE_HEIGHT}
                      canEdit={canEditExperiment}
                      allowImages={allowImages}
                      openCarousel={(variationId, index) => {
                        setOpenCarousel({ variationId, index });
                      }}
                      mutate={mutate}
                      percent={percentages?.[i]}
                      isPublic={isPublic}
                      shareUid={shareUid}
                      shareType={shareType}
                      onEditMetadata={onEditMetadata}
                      onEditTraffic={onEditTraffic}
                      showNoImage={
                        experiment.status === "draft" || someVariationHasImage
                      }
                      capWidth={centered}
                    />
                  );

                  if (onAddVariation && !fullLastRow && i === lastIndex) {
                    return (
                      <Box
                        key={v.id}
                        height="100%"
                        style={{ position: "relative" }}
                      >
                        {box}
                        <Box
                          style={{
                            position: "absolute",
                            left: "calc(100% + var(--space-3))",
                            top: "50%",
                            transform: "translateY(-50%)",
                          }}
                        >
                          <AddVariationButton onClick={onAddVariation} />
                        </Box>
                      </Box>
                    );
                  }

                  return (
                    <Box key={v.id} height="100%">
                      {box}
                    </Box>
                  );
                })}
              </Grid>
            </MaybeSortable>
            {isSetup && onAddVariation && !scrolls ? (
              // In the gutter to the right of the row, 12px out, centred on the
              // cards, as the design places it. FALLBACK: Radix IconButton; @/ui/
              // has no icon button.
              <Box
                style={{
                  position: "absolute",
                  left: "calc(100% + var(--space-3))",
                  top: "50%",
                  transform: "translateY(-50%)",
                }}
              >
                <IconButton
                  variant="outline"
                  color="gray"
                  size="2"
                  onClick={() => onAddVariation()}
                  aria-label="Add variation"
                  title="Add variation"
                >
                  <PiPlus size="14" />
                </IconButton>
              </Box>
            ) : null}
          </Box>
          {onAddVariation && fullLastRow && !isSetup ? (
            <Flex justify="center" style={{ marginTop: 20 }}>
              <AddVariationButton onClick={onAddVariation} />
            </Flex>
          ) : null}
          {variationRow ? (
            <Box mt="4">
              {/* "Values" and Type stay put while the row scrolls (set in
                review). */}
              {variationRow.header ? (
                <Box mb="2" className={setupFunnelStyles.stickyVisible}>
                  {variationRow.header}
                </Box>
              ) : null}
              <Grid gap={isSetup ? "4" : gap} {...gridLayout}>
                {variations
                  .filter(
                    (v) => !variationsList || variationsList.includes(v.id),
                  )
                  .map((v) => {
                    // Moves with its card mid-drag (see CellMotion).
                    const motion = cellMotion[v.id];
                    return (
                      <Box
                        key={v.id}
                        minWidth="0"
                        style={
                          motion
                            ? {
                                position: "relative",
                                transform: motion.transform,
                                transition: motion.transition,
                                zIndex: motion.dragging ? 1 : undefined,
                              }
                            : undefined
                        }
                      >
                        {variationRow.renderCell(v.id)}
                      </Box>
                    );
                  })}
              </Grid>
            </Box>
          ) : null}
        </Box>
      </Box>
      {openCarousel && (
        <ExperimentCarouselModal
          experiment={experiment}
          currentVariation={openCarousel.variationId}
          currentScreenshot={openCarousel.index}
          imageCache={imageCache}
          close={() => {
            setOpenCarousel(null);
          }}
          mutate={mutate}
          deleteImage={
            !canEditExperiment
              ? undefined
              : async (variantIndex, screenshotPath) => {
                  const { status, message } = await apiCall<{
                    status: number;
                    message?: string;
                  }>(
                    `/experiment/${experiment.id}/variation/${variantIndex}/screenshot`,
                    {
                      method: "DELETE",
                      body: JSON.stringify({
                        url: screenshotPath,
                      }),
                    },
                  );

                  if (status >= 400) {
                    throw new Error(
                      message || "There was an error deleting the image",
                    );
                  }

                  mutate?.();
                }
          }
        />
      )}
    </Box>
  );
};

export default VariationsTable;
