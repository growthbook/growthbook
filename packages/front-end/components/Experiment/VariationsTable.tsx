import {
  ExperimentInterfaceStringDates,
  Variation,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { FeatureInterface } from "shared/types/feature";
import { FC, useState, useRef, useCallback } from "react";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import {
  PiCameraLight,
  PiCameraPlusLight,
  PiPencilSimpleFill,
  PiPlusCircle,
} from "react-icons/pi";
import clsx from "clsx";
import { BsThreeDotsVertical } from "react-icons/bs";
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
import VariationServedValue from "@/components/Experiment/VariationServedValue";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import styles from "./VariationsTable.module.scss";

export const MAX_VARIATION_WIDTH = 336;

// A small marker, so an empty variation doesn't reserve screenshot-sized space.
const NO_IMAGE_SIZE = 42;
const MAX_IMAGE_HEIGHT = 150;

// Radix Themes breakpoints (px), mirroring `@radix-ui/themes` `--xs`/`--sm`.

export const getVariationGridColumns = (cols: number) => ({
  initial: `minmax(0, ${MAX_VARIATION_WIDTH}px)`,
  xs: `repeat(${Math.min(cols, 2)}, minmax(0, ${MAX_VARIATION_WIDTH}px))`,
  sm: `repeat(${cols}, minmax(0, ${MAX_VARIATION_WIDTH}px))`,
  md: `repeat(${cols}, minmax(0, ${MAX_VARIATION_WIDTH}px))`,
});

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
  /** Each variation's served value, when the sole implementation is a flag. */
  servedValues?: { variationId: string; value: string }[];
  servedValueFeature?: FeatureInterface;
  servedValueSparse?: boolean;
  /** The values shown are an unpublished draft, not what is live. */
  servedValueIsDraft?: boolean;
  /** Variations whose draft value differs from live; null when not shown. */
  servedValueDraftIds?: Set<string> | null;
  /** Names the draft the served values come from; omitted for a managed flag. */
  servedValueDraftName?: string;
  /** Other drafts this readout is not showing. */
  servedValueDraftNote?: string;
}

function AddVariationButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip content="Add variation" side="top">
      <IconButton
        variant="ghost"
        color="violet"
        radius="full"
        size="2"
        onClick={() => onClick()}
        aria-label="Add variation"
      >
        <PiPlusCircle size="16" />
      </IconButton>
    </Tooltip>
  );
}

function NoImageBox({ canEdit }: { canEdit?: boolean }) {
  const box = (
    <Flex
      align="center"
      justify="center"
      className={clsx(
        "appbox mb-0",
        styles.noImageBox,
        canEdit && styles.noImageBoxEditable,
      )}
      flexShrink="0"
      style={{
        // Right-aligns it when it stands alone; the drop target has its own.
        marginLeft: "auto",
        width: NO_IMAGE_SIZE + "px",
        height: NO_IMAGE_SIZE + "px",
        color: "var(--slate-8)",
        border: "none",
      }}
    >
      {canEdit ? (
        <PiCameraPlusLight size="26px" />
      ) : (
        <PiCameraLight size="26px" />
      )}
    </Flex>
  );

  // Only the upload target earns a tooltip.
  return canEdit ? (
    <Tooltip content="Upload image" side="top">
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
  onEditTraffic,
  capWidth = false,
  servedValue,
  servedValueFeature,
  servedValueSparse,
  servedValueIsDraft,
  servedValueDraftIds,
  servedValueDraftName,
  servedValueDraftNote,
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
  /** The value this variation serves, when the sole implementation is a flag. */
  servedValue?: string;
  servedValueFeature?: FeatureInterface;
  servedValueSparse?: boolean;
  servedValueIsDraft?: boolean;
  /** Variations whose draft value differs from live; null when not shown. */
  servedValueDraftIds?: Set<string> | null;
  /** Names the draft the served values come from; omitted for a managed flag. */
  servedValueDraftName?: string;
  /** Other drafts this readout is not showing. */
  servedValueDraftNote?: string;
  /** Offered instead of a value when there is no Feature Flag yet. */
}) {
  const { blockFileUploads } = useOrgSettings();
  const isBandit = experiment.type === "multi-armed-bandit";
  const shouldShowSplit = showSplit ?? !isBandit;

  const descriptionSnippet = !showDescription ? null : v.description ? (
    v.description
  ) : experiment.status === "draft" ? (
    <Text color="text-disabled">No description</Text>
  ) : null;
  // Beside the placeholder without a screenshot, below the carousel with one.
  const showsPlaceholder =
    allowImages && v.screenshots.length === 0 && showNoImage;
  const descriptionBelow = !!descriptionSnippet && !showsPlaceholder;

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
            {/* Radix ghost buttons carry a negative margin, so the gap alone
                won't separate them. */}
            <Flex align="center" gap="1" flexShrink="0" mr="-1">
              {canEdit && onEditTraffic ? (
                <IconButton
                  variant="ghost"
                  size="2"
                  color="violet"
                  radius="full"
                  style={{ margin: 0 }}
                  onClick={() => onEditTraffic(v.id)}
                  aria-label="Edit variation"
                >
                  <PiPencilSimpleFill size="16" />
                </IconButton>
              ) : null}
              {canEdit && onEditMetadata ? (
                <DropdownMenu
                  trigger={
                    <IconButton
                      variant="ghost"
                      color="gray"
                      radius="full"
                      size="2"
                      highContrast
                      style={{ margin: 0 }}
                    >
                      <BsThreeDotsVertical size={16} />
                    </IconButton>
                  }
                  menuPlacement="end"
                  variant="soft"
                >
                  <DropdownMenuItem onClick={() => onEditMetadata(i)}>
                    Edit metadata
                  </DropdownMenuItem>
                </DropdownMenu>
              ) : null}
            </Flex>
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
            ) : !showNoImage ? null : (
              // No screenshot: the description shares the row with the
              // placeholder rather than leaving the space empty.
              <Flex align="start" gap="3">
                <Box flexGrow="1" minWidth="0" mt="2">
                  {descriptionSnippet}
                </Box>
                {canEdit && !blockFileUploads ? (
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
          {servedValueFeature ? (
            <VariationServedValue
              value={servedValue ?? ""}
              feature={servedValueFeature}
              sparse={servedValueSparse}
              isDraft={
                servedValueIsDraft &&
                (!servedValueDraftIds || servedValueDraftIds.has(v.id))
              }
              draftName={servedValueDraftName}
              draftNote={servedValueDraftNote}
            />
          ) : null}
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
  servedValues,
  servedValueFeature,
  servedValueSparse,
  servedValueIsDraft,
  servedValueDraftIds,
  servedValueDraftName,
  servedValueDraftNote,
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

  const cols = centered
    ? Math.min(variations.length, 3)
    : variations.length > 4
      ? 4
      : variations.length;
  const gap = "4";

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
              servedValue={
                servedValues?.find((sv) => sv.variationId === v.id)?.value
              }
              servedValueFeature={servedValueFeature}
              servedValueSparse={servedValueSparse}
              servedValueIsDraft={servedValueIsDraft}
              servedValueDraftIds={servedValueDraftIds}
              servedValueDraftName={servedValueDraftName}
              servedValueDraftNote={servedValueDraftNote}
              showNoImage={
                experiment.status === "draft" || someVariationHasImage
              }
              capWidth={centered}
            />
          );

          if (onAddVariation && i === lastIndex) {
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
