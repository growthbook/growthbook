import {
  ExperimentInterfaceStringDates,
  Screenshot,
  Variation,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { FC, useState, useRef } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiCameraLight, PiCameraPlusLight } from "react-icons/pi";
import clsx from "clsx";
import { trafficSplitPercentages } from "@/services/utils";
import Carousel from "@/components/Carousel";
import {
  ScreenshotUploadError,
  ScreenshotUploadOverlay,
  useScreenshotUpload,
} from "@/components/EditExperiment/ScreenshotUpload";
import AuthorizedImage from "@/components/AuthorizedImage";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import ExperimentCarouselModal from "@/components/Experiment/ExperimentCarouselModal";
import useOrgSettings from "@/hooks/useOrgSettings";
import Metadata from "@/ui/Metadata";
import VariationLabel from "@/ui/VariationLabel";
import QuickEditButton, {
  revealsQuickEdit,
} from "@/components/Experiment/TabbedPage/QuickEditButton";
import styles from "./VariationsTable.module.scss";

// A small marker, so an empty variation doesn't reserve screenshot-sized space.
const NO_IMAGE_SIZE = 42;
// The stand-in for a screenshot that won't load.
const UNAVAILABLE_IMAGE_HEIGHT = 150;
// A tall screenshot scales down to this, centred, keeping its proportions.
const SUMMARY_IMAGE_MAX_HEIGHT = 300;

// Narrower than this and a card has no room for a name beside its controls.
const MIN_VARIATION_WIDTH = 220;

// Wraps on the grid's own width, not the viewport's, so a docked details panel
// narrows it.
const VARIATION_GRID_COLUMNS = `repeat(auto-fit, minmax(min(100%, ${MIN_VARIATION_WIDTH}px), 1fr))`;

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
  // Only an image that failed to load stays out of the lightbox; the rest of
  // its carousel still opens it.
  const failedPaths = useRef(new Set<string>());

  const handleError = (path: string, msg: string) => {
    failedPaths.current.add(path);
    return (
      <Flex
        title={msg}
        align="center"
        justify="center"
        className="appbox mb-0"
        width="100%"
        style={{
          backgroundColor: "var(--slate-a3)",
          height: UNAVAILABLE_IMAGE_HEIGHT + "px",
          width: "100%",
          color: "var(--slate-a9)",
          // Kept out of the lightbox, so not clickable either.
          cursor: "default",
        }}
      >
        <Box>
          <PiCameraLight />
        </Box>
      </Flex>
    );
  };

  return (
    <Carousel
      onClick={(i) => {
        const path = variation.screenshots[i]?.path;
        if (onClick && path && !failedPaths.current.has(path)) onClick(i);
      }}
      maxChildHeight={maxChildHeight}
    >
      {variation.screenshots.map((s) => (
        <AuthorizedImage
          imageCache={imageCache}
          className="experiment-image"
          src={s.path}
          key={s.path}
          // Its card takes file drops, so dragging it would upload a copy.
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
          onErrorMsg={(msg) => handleError(s.path, msg)}
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
  /** Defaults to hidden for bandits. Pass false where the split is shown elsewhere. */
  showSplit?: boolean;
  isPublic?: boolean;
  shareUid?: string;
  shareType?: "experiment" | "report";
  onEditMetadata?: (variationIndex: number) => void;
  /** Takes an upload as a staged change instead of saving it. */
  stageScreenshot?: (variationId: string, screenshot: Screenshot) => void;
  // When true, the cards fill the grid's own width, wrapping as it narrows.
  fill?: boolean;
}

function NoImageBox({ onUpload }: { onUpload?: () => void }) {
  const box = (
    <Flex
      align="center"
      justify="center"
      className={clsx(
        "appbox mb-0",
        styles.noImageBox,
        onUpload && styles.noImageBoxEditable,
      )}
      flexShrink="0"
      style={{
        marginLeft: "auto",
        width: NO_IMAGE_SIZE + "px",
        height: NO_IMAGE_SIZE + "px",
        color: "var(--slate-8)",
        border: "none",
      }}
    >
      {onUpload ? (
        <PiCameraPlusLight size="26px" />
      ) : (
        <PiCameraLight size="26px" />
      )}
    </Flex>
  );

  return onUpload ? (
    <Tooltip content="Upload, drop or paste an image" side="top">
      <button
        type="button"
        aria-label="Upload image"
        className={styles.noImageButton}
        onClick={onUpload}
      >
        {box}
      </button>
    </Tooltip>
  ) : (
    box
  );
}

export function VariationBox({
  i,
  v,
  experiment,
  showDescription = true,
  showIds,
  showNoImage = true,
  height,
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
  stageScreenshot,
}: {
  i: number;
  v: Variation;
  experiment: Pick<ExperimentInterfaceStringDates, "id" | "status" | "type">;
  showDescription?: boolean;
  showIds?: boolean;
  showNoImage?: boolean;
  // A cap on an image's height; without one it shows at its own.
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
  stageScreenshot?: (variationId: string, screenshot: Screenshot) => void;
}) {
  const { blockFileUploads } = useOrgSettings();
  const canUpload = !!canEdit && allowImages && !blockFileUploads;
  const upload = useScreenshotUpload({
    experiment: experiment.id,
    variation: i,
    attach: !stageScreenshot,
    onSuccess: (screenshot) =>
      stageScreenshot ? stageScreenshot(v.id, screenshot) : mutate?.(),
    // The whole card takes a drop; only the placeholder opens the picker.
    noClick: true,
    disabled: !canUpload,
  });
  const isBandit = experiment.type === "multi-armed-bandit";
  const shouldShowSplit = showSplit ?? !isBandit;

  const descriptionSnippet = !showDescription ? null : v.description ? (
    v.description
  ) : experiment.status === "draft" || canEdit ? (
    <Text color="text-disabled">No description</Text>
  ) : null;
  // Beside the placeholder without a screenshot, below the carousel with one.
  const showsPlaceholder =
    allowImages && v.screenshots.length === 0 && showNoImage;
  const descriptionBelow = !!descriptionSnippet && !showsPlaceholder;
  const split =
    shouldShowSplit && percent !== undefined ? `${percent.toFixed(0)}%` : null;

  return (
    <Box
      key={i}
      p="4"
      {...upload.getRootProps()}
      // Holds controls of its own, so it isn't one button.
      role={undefined}
      // Focusable by click but not by Tab, so a paste reaches the card.
      tabIndex={canUpload ? -1 : undefined}
      onPaste={upload.onPaste}
      className={clsx(
        "appbox mb-0 position-relative variation",
        revealsQuickEdit,
      )}
      style={{
        minWidth,
        // Fill the grid-item wrapper so all cards in a row share the same height.
        height: "100%",
      }}
    >
      {canUpload ? <input {...upload.getInputProps()} /> : null}
      <Flex direction="column" height="100%">
        <Box>
          <Flex gap="2" align="center" justify="between">
            <Box minWidth="0" flexGrow="1">
              <VariationLabel number={i} name={v.name} size="lg" />
            </Box>
            {/* Radix ghost buttons carry a negative margin. */}
            <Flex align="center" flexShrink="0" mr="-1">
              {canEdit && onEditMetadata ? (
                <QuickEditButton
                  size="2"
                  label="Edit variation"
                  onClick={() => onEditMetadata(i)}
                />
              ) : null}
            </Flex>
          </Flex>
        </Box>
        {allowImages && (
          <Box
            mt={showNoImage ? "2" : "0"}
            // Only a carousel takes the leftover height, or cards fall out of step.
            flexGrow={v.screenshots.length > 0 ? "1" : "0"}
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
            ) : !showNoImage ? null : (
              <Flex align="start" gap="3">
                <Box flexGrow="1" minWidth="0" mt="2">
                  {descriptionSnippet}
                </Box>
                <Box flexShrink="0" width={NO_IMAGE_SIZE + "px"}>
                  <NoImageBox onUpload={canUpload ? upload.open : undefined} />
                </Box>
              </Flex>
            )}
          </Box>
        )}
        {descriptionBelow || showIds || split ? (
          <Flex direction="column" gap="2" mt="2">
            {descriptionBelow ? <Box>{descriptionSnippet}</Box> : null}
            {showIds ? <code className="small">ID: {v.key}</code> : null}
            {split ? <Metadata label="Split" value={split} /> : null}
          </Flex>
        ) : null}
        {upload.error ? (
          <Box mt="2">
            <ScreenshotUploadError error={upload.error} />
          </Box>
        ) : null}
      </Flex>
      <ScreenshotUploadOverlay
        dragging={upload.isDragActive}
        rejecting={upload.isDragReject}
        progress={upload.progress}
      />
    </Box>
  );
}

const VariationsTable: FC<Props> = ({
  experiment,
  variationsList,
  canEditExperiment,
  allowImages = true,
  noMargin = false,
  showSplit,
  mutate,
  isPublic = false,
  shareUid,
  shareType = "experiment",
  onEditMetadata,
  stageScreenshot,
  fill = false,
}) => {
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

  const hasUniqueIDs = variations.some((v, i) => v.key !== i + "");
  const someVariationHasImage = variations.some(
    (v) => v.screenshots.length > 0,
  );

  const cols = variations.length > 4 ? 4 : variations.length;
  const gap = "4";

  return (
    <Box mx={noMargin ? "0" : "4"}>
      <Grid
        gap={gap}
        style={{ gridAutoRows: "1fr" }}
        {...(fill
          ? { columns: VARIATION_GRID_COLUMNS }
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
          return (
            <Box key={v.id} height="100%">
              <VariationBox
                i={v.index}
                v={v}
                experiment={experiment}
                height={SUMMARY_IMAGE_MAX_HEIGHT}
                showIds={hasUniqueIDs}
                canEdit={canEditExperiment}
                allowImages={allowImages}
                openCarousel={(variationId, index) => {
                  setOpenCarousel({ variationId, index });
                }}
                mutate={mutate}
                percent={percentages?.[i]}
                showSplit={showSplit}
                isPublic={isPublic}
                shareUid={shareUid}
                shareType={shareType}
                onEditMetadata={onEditMetadata}
                stageScreenshot={stageScreenshot}
                showNoImage={
                  experiment.status === "draft" ||
                  canEditExperiment ||
                  someVariationHasImage
                }
              />
            </Box>
          );
        })}
      </Grid>
      {openCarousel && (
        <ExperimentCarouselModal
          experiment={experiment}
          currentVariation={openCarousel.variationId}
          currentScreenshot={openCarousel.index}
          imageCache={imageCache}
          close={() => {
            setOpenCarousel(null);
          }}
        />
      )}
    </Box>
  );
};

export default VariationsTable;
