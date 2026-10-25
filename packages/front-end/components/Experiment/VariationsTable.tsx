import {
  ExperimentInterfaceStringDates,
  Variation,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { FC, useState, useRef, useCallback } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiCameraLight, PiCameraPlusLight } from "react-icons/pi";
import clsx from "clsx";
import { trafficSplitPercentages } from "@/services/utils";
import Carousel from "@/components/Carousel";
import ScreenshotUpload from "@/components/EditExperiment/ScreenshotUpload";
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
import { useEditsBlockedReason } from "@/components/Experiment/TabbedPage/ExperimentEdits";
import styles from "./VariationsTable.module.scss";

// A small marker, so an empty variation doesn't reserve screenshot-sized space.
const NO_IMAGE_SIZE = 42;
const MAX_IMAGE_HEIGHT = 150;

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
  /** Defaults to hidden for bandits. Pass false where the split is shown elsewhere. */
  showSplit?: boolean;
  isPublic?: boolean;
  shareUid?: string;
  shareType?: "experiment" | "report";
  onEditMetadata?: (variationIndex: number) => void;
  // When true, the cards fill the grid's own width, wrapping as it narrows.
  fill?: boolean;
}

function NoImageBox({
  canEdit,
  blockedReason = null,
}: {
  canEdit?: boolean;
  /** Why an upload has to wait, shown on a disabled placeholder. */
  blockedReason?: string | null;
}) {
  const blocked = !!canEdit && !!blockedReason;
  const box = (
    <Flex
      align="center"
      justify="center"
      className={clsx(
        "appbox mb-0",
        styles.noImageBox,
        canEdit && !blocked && styles.noImageBoxEditable,
      )}
      flexShrink="0"
      style={{
        marginLeft: "auto",
        width: NO_IMAGE_SIZE + "px",
        height: NO_IMAGE_SIZE + "px",
        color: "var(--slate-8)",
        border: "none",
        cursor: blocked ? "not-allowed" : undefined,
      }}
      aria-disabled={blocked || undefined}
    >
      {canEdit ? (
        <PiCameraPlusLight size="26px" />
      ) : (
        <PiCameraLight size="26px" />
      )}
    </Flex>
  );

  return canEdit ? (
    <Tooltip content={blockedReason ?? "Upload image"} side="top">
      {box}
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
}) {
  const { blockFileUploads } = useOrgSettings();
  // The upload writes straight to the stored variation at index `i`, which
  // staged edits may have moved; their save would also drop it.
  const uploadBlocked = useEditsBlockedReason();
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

  return (
    <Box
      key={i}
      p="4"
      pb="3"
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
                {/* The upload wrapper is the flex item, so it holds the width. */}
                <Box flexShrink="0" width={NO_IMAGE_SIZE + "px"}>
                  {canEdit && !blockFileUploads ? (
                    uploadBlocked ? (
                      <NoImageBox canEdit blockedReason={uploadBlocked} />
                    ) : (
                      <ScreenshotUpload
                        variation={i}
                        experiment={experiment.id}
                        onSuccess={() => mutate?.()}
                      >
                        <NoImageBox canEdit />
                      </ScreenshotUpload>
                    )
                  ) : (
                    <NoImageBox canEdit={false} />
                  )}
                </Box>
              </Flex>
            )}
          </Box>
        )}
        <Box mt="2">
          {descriptionBelow ? <Box mb="2">{descriptionSnippet}</Box> : null}
          {showIds ? <code className="small">ID: {v.key}</code> : null}
          <Flex align="center" justify="between">
            <Box>
              {shouldShowSplit && percent !== undefined ? (
                <Metadata label="Split" value={`${percent.toFixed(0)}%`} />
              ) : null}
            </Box>
            {allowImages && (
              <Flex align="center" justify="end" gap="2">
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
                showIds={hasUniqueIDs}
                height={MAX_IMAGE_HEIGHT}
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
