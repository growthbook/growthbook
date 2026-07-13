import {
  ExperimentInterfaceStringDates,
  Variation,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { FC, useState, useRef, useCallback, useEffect } from "react";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import {
  PiCameraLight,
  PiCameraPlusLight,
  PiPencilSimpleFill,
  PiPlusCircle,
  PiUploadSimple,
} from "react-icons/pi";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
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
  shareType?: "experiment" | "report" | "dashboard";
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
  shareType?: "experiment" | "report" | "dashboard";
  onEditMetadata?: (variationIndex: number) => void;
  onAddVariation?: () => void;
  onEditTraffic?: (variationId?: string) => void;
  // When true, the grid is centered and capped at 3 columns.
  centered?: boolean;
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
  experiment: ExperimentInterfaceStringDates;
  showDescription?: boolean;
  showIds?: boolean;
  showNoImage?: boolean;
  height?: number;
  canEdit?: boolean;
  allowImages?: boolean;
  openCarousel?: (variationId: string, index: number) => void;
  mutate?: () => void;
  percent?: number;
  minWidth?: string | number;
  isPublic?: boolean;
  shareUid?: string;
  shareType?: "experiment" | "report" | "dashboard";
  onEditMetadata?: (variationIndex: number) => void;
  onEditTraffic?: (variationId?: string) => void;
  capWidth?: boolean;
}) {
  const { blockFileUploads } = useOrgSettings();
  const isBandit = experiment.type === "multi-armed-bandit";

  return (
    <Box
      key={i}
      p="5"
      pb="3"
      className={`appbox mb-0 position-relative variation variation${i} with-variation-label`}
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
              <VariationLabel number={i} name={v.name} size="large" />
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
              {!isBandit && percent !== undefined ? (
                <Metadata
                  label="Split"
                  value={`${percent.toFixed(0)}%`}
                  size="small"
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
                        <Text size="small" weight="semibold">
                          Image
                        </Text>
                      </Flex>
                    </Link>
                  </ScreenshotUpload>
                )}
                {v.screenshots.length > 0 ? (
                  <Text color="text-mid" size="small" whiteSpace="nowrap">
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
}) => {
  const { apiCall } = useAuth();
  const variations = getLatestPhaseVariations(experiment);
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
  const collapseEmptyVariations = useFeatureIsOn("simple-experiment-flow");

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

  return (
    <Box mx={noMargin ? "0" : "4"}>
      <Grid
        gap={gap}
        style={{ gridAutoRows: "1fr" }}
        {...(centered
          ? { justify: "center", columns: getVariationGridColumns(cols) }
          : {
              columns: {
                initial: "1",
                xs: "2",
                sm: cols === 2 ? "2" : "3",
                md: cols.toString(),
              },
            })}
      >
        {variations.map((v, i) => {
          if (variationsList && !variationsList.includes(v.id)) return null;
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
                !collapseEmptyVariations ||
                experiment.status === "draft" ||
                someVariationHasImage
              }
              capWidth={centered}
            />
          );

          if (onAddVariation && !fullLastRow && i === lastIndex) {
            return (
              <Box key={v.id} height="100%" style={{ position: "relative" }}>
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
      {onAddVariation && fullLastRow ? (
        <Flex justify="center" style={{ marginTop: 20 }}>
          <AddVariationButton onClick={onAddVariation} />
        </Flex>
      ) : null}
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
