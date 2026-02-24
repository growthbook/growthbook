import {
  ExperimentInterfaceStringDates,
  Variation,
} from "shared/types/experiment";
import { getVariationsForPhase } from "shared/experiments";
import { FC, useState, useRef, useCallback } from "react";
import { Box, Flex, Grid, Heading, Text } from "@radix-ui/themes";
import { PiCameraLight, PiCameraPlusLight } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { trafficSplitPercentages } from "@/services/utils";
import Carousel from "@/components/Carousel";
import ScreenshotUpload from "@/components/EditExperiment/ScreenshotUpload";
import AuthorizedImage from "@/components/AuthorizedImage";
import Button from "@/ui/Button";
import ExperimentCarouselModal from "@/components/Experiment/ExperimentCarouselModal";
import useOrgSettings from "@/hooks/useOrgSettings";

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
          <Text size="8">
            <PiCameraLight />
          </Text>
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
      <Text size="8">
        {canEdit ? <PiCameraPlusLight /> : <PiCameraLight />}
      </Text>
    </Flex>
  );
}

export function VariationBox({
  i,
  v,
  experiment,
  showDescription,
  showIds,
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
}: {
  i: number;
  v: Variation;
  experiment: ExperimentInterfaceStringDates;
  showDescription?: boolean;
  showIds?: boolean;
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
}) {
  const { blockFileUploads } = useOrgSettings();

  return (
    <Box
      key={i}
      p="5"
      pb="3"
      className={`appbox mb-0 position-relative variation variation${i} with-variation-label`}
      style={{
        minWidth,
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
      <Flex gap="2" direction="column" justify="between" height="100%">
        <Box>
          <Box mb="3">
            <Flex gap="0">
              <Box className="">
                <span className="circle-label label">{i}</span>
              </Box>
              <Heading as="h4" size="3" mb="0">
                {v.name}
              </Heading>
            </Flex>
          </Box>
          {allowImages && (
            <Box>
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
              ) : (
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
        <Box>
          {showDescription ? <Box>{v.description}</Box> : null}
          {showIds ? <code className="small">ID: {v.key}</code> : null}
          <Flex align="center" justify="between">
            <Box>
              {experiment.type !== "multi-armed-bandit" &&
              percent !== undefined ? (
                <Box>Split: {percent.toFixed(0)}%</Box>
              ) : null}
            </Box>
            {allowImages && (
              <Flex align="center" justify="end" gap="2">
                {v.screenshots.length > 0 ? (
                  <Text className="text-muted">
                    {v.screenshots.length} image
                    {v.screenshots.length > 1 ? "s" : ""}
                  </Text>
                ) : null}
                {canEdit && !blockFileUploads && (
                  <div>
                    <ScreenshotUpload
                      variation={i}
                      experiment={experiment.id}
                      onSuccess={() => mutate?.()}
                    >
                      <Button variant="ghost" style={{ padding: 0, margin: 0 }}>
                        Add{v.screenshots.length > 0 ? "" : " image"}
                      </Button>
                    </ScreenshotUpload>
                  </div>
                )}
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
}) => {
  const { apiCall } = useAuth();
  const variations = getVariationsForPhase(experiment, null);
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

  // set some variables for the display of the component - could make options
  const cols = variations.length > 4 ? 4 : variations.length;
  const gap = "4";
  const maxImageHeight = hasAnyImages ? 200 : 110; // shrink the image height if there are no images

  return (
    <Box mx={noMargin ? "0" : "4"}>
      <Grid
        gap={gap}
        columns={{
          initial: "1",
          xs: "2",
          sm: cols === 2 ? "2" : "3",
          md: cols.toString(),
        }}
      >
        {variations.map((v, i) =>
          variationsList && !variationsList.includes(v.id) ? null : (
            <VariationBox
              key={i}
              i={i}
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
            />
          ),
        )}
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
