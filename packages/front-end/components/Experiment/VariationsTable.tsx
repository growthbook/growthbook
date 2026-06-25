import {
  ExperimentInterfaceStringDates,
  Variation,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { FC, useState, useRef, useCallback, useEffect } from "react";
import { Box, Flex, Grid, Heading, IconButton } from "@radix-ui/themes";
import {
  PiCameraLight,
  PiCameraPlusLight,
  PiPencilSimple,
  PiPlusCircle,
  PiUploadSimple,
} from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { trafficSplitPercentages } from "@/services/utils";
import Carousel from "@/components/Carousel";
import ScreenshotUpload from "@/components/EditExperiment/ScreenshotUpload";
import AuthorizedImage from "@/components/AuthorizedImage";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import ExperimentCarouselModal from "@/components/Experiment/ExperimentCarouselModal";
import useOrgSettings from "@/hooks/useOrgSettings";
import Metadata from "@/ui/Metadata";

export const MAX_VARIATION_WIDTH = 336;

// Radix Themes breakpoints (px). These mirror `@radix-ui/themes`'
// `src/styles/breakpoints.css` (`--xs`/`--sm`)
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
  onEditTraffic?: () => void;
}

function AddVariationButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton
      variant="ghost"
      color="violet"
      radius="full"
      onClick={onClick}
      aria-label="Add variation"
    >
      <PiPlusCircle size="15" />
    </IconButton>
  );
}

function NoImageBox({
  canEdit,
  height = 200,
}: {
  canEdit?: boolean;
  height: number;
}) {
  return (
    <Flex
      align="center"
      justify="center"
      className="appbox mb-0"
      width="100%"
      style={{
        backgroundColor: "var(--slate-a3)",
        height: height + "px",
        color: "var(--slate-a9)",
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
  showDescription,
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
  shareType?: "experiment" | "report";
  onEditMetadata?: (variationIndex: number) => void;
  onEditTraffic?: () => void;
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
        maxWidth: MAX_VARIATION_WIDTH + "px",
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
      <Flex direction="column" justify="between" height="100%">
        <Box>
          <Box>
            <Flex gap="0" align="center" justify="between">
              <Flex gap="0" align="center">
                <Box className="">
                  <span className="circle-label label">{i}</span>
                </Box>
                <Heading as="h4" size="3" mb="0">
                  {v.name}
                </Heading>
              </Flex>
              {canEdit && onEditMetadata && onEditTraffic ? (
                <IconButton
                  variant="ghost"
                  size="1"
                  color="violet"
                  onClick={() => {
                    experiment.status === "running"
                      ? onEditMetadata(i)
                      : onEditTraffic();
                  }}
                  aria-label="Edit variation"
                >
                  <PiPencilSimple size="15" />
                </IconButton>
              ) : null}
            </Flex>
          </Box>
          {allowImages && (
            <Box mt={showNoImage ? "3" : "0"}>
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
              ) : !showNoImage ? null : (
                <>
                  {canEdit && !blockFileUploads ? (
                    <>
                      <ScreenshotUpload
                        variation={i}
                        experiment={experiment.id}
                        onSuccess={() => mutate?.()}
                      >
                        <NoImageBox height={height} />
                      </ScreenshotUpload>
                    </>
                  ) : (
                    <NoImageBox height={height} canEdit={false} />
                  )}
                </>
              )}
            </Box>
          )}
        </Box>
        <Box mt="2">
          {showDescription ? (
            <Box mb="2">
              {v.description || <Text color="text-mid">--</Text>}
            </Box>
          ) : null}
          {showIds ? <code className="small">ID: {v.key}</code> : null}
          <Flex align="center" justify="between">
            <Box>
              {!isBandit && percent !== undefined ? (
                <Metadata label="Split" value={`${percent.toFixed(0)}%`} />
              ) : null}
            </Box>
            {allowImages && (
              <Flex align="center" justify="end" gap="2">
                {canEdit && !blockFileUploads && (
                  <div>
                    <ScreenshotUpload
                      variation={i}
                      experiment={experiment.id}
                      onSuccess={() => mutate?.()}
                    >
                      <Button
                        icon={<PiUploadSimple size="15" />}
                        variant="ghost"
                        size="xs"
                        style={{ padding: 0, margin: 0 }}
                      >
                        Image
                      </Button>
                    </ScreenshotUpload>
                  </div>
                )}
                {v.screenshots.length > 0 ? (
                  <Text color="text-mid">
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

  const hasDescriptions = variations.some((v) => !!v.description?.trim());
  const hasUniqueIDs = variations.some((v, i) => v.key !== i + "");
  const hasAnyImages = variations.some((v) => v.screenshots.length > 0);

  const cols = Math.min(variations.length, 3);
  const gap = "4";
  const maxImageHeight = hasAnyImages ? 200 : 72;

  const maxColsForViewport = useMaxColsForViewport();
  const columnsPerRow = Math.min(variations.length, maxColsForViewport);
  const fullLastRow =
    columnsPerRow > 0 && variations.length % columnsPerRow === 0;
  const lastIndex = variations.length - 1;

  return (
    <Box mx={noMargin ? "0" : "4"}>
      <Grid gap={gap} justify="center" columns={getVariationGridColumns(cols)}>
        {variations.map((v, i) => {
          if (variationsList && !variationsList.includes(v.id)) return null;
          const box = (
            <VariationBox
              i={v.index}
              v={v}
              experiment={experiment}
              showDescription={hasDescriptions}
              showIds={hasUniqueIDs}
              height={maxImageHeight}
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
              showNoImage={experiment.status === "draft"}
            />
          );

          if (onAddVariation && !fullLastRow && i === lastIndex) {
            return (
              <Box key={v.id} style={{ position: "relative" }}>
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

          return <Box key={v.id}>{box}</Box>;
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
