import {
  ExperimentInterfaceStringDates,
  Variation,
} from "back-end/types/experiment";
import { FC, useState } from "react";
import { Box, Flex, Grid, Heading, Text } from "@radix-ui/themes";
import { PiCameraLight, PiCameraPlusLight } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { trafficSplitPercentages } from "@/services/utils";
import Carousel from "@/components/Carousel";
import ScreenshotUpload from "@/components/EditExperiment/ScreenshotUpload";
import AuthorizedImage from "@/components/AuthorizedImage";
import Button from "@/components/Radix/Button";
import ExperimentCarouselModal from "@/components/Experiment/ExperimentCarouselModal";

const imageCache = {};

const ScreenshotCarousel: FC<{
  variation: Variation;
  maxChildHeight?: number;
  onClick?: (i: number) => void;
}> = ({ variation, maxChildHeight, onClick }) => {
  const [allowClick, setAllowClick] = useState(true);
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
          onErrorMsg={(msg) => {
            setAllowClick(false);
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
          }}
        />
      ))}
    </Carousel>
  );
};

interface Props {
  experiment: ExperimentInterfaceStringDates;
  canEditExperiment: boolean;
  // for some experiments, screenshots don't make sense - this is for a future state where you can mark exp as such.
  allowImages?: boolean;
  mutate?: () => void;
}

const VariationsTable: FC<Props> = ({
  experiment,
  canEditExperiment,
  allowImages = true,
  mutate,
}) => {
  const { apiCall } = useAuth();
  const { variations } = experiment;
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

  const noImageBox = () => {
    return (
      <Flex
        align="center"
        justify="center"
        className="appbox mb-0"
        width="100%"
        style={{
          backgroundColor: "var(--slate-a3)",
          height: maxImageHeight + "px",
          color: "var(--slate-a9)",
        }}
      >
        <Text size="8">
          {canEditExperiment ? <PiCameraPlusLight /> : <PiCameraLight />}
        </Text>
      </Flex>
    );
  };

  return (
    <Box mx="4">
      <Grid
        gap={gap}
        columns={{
          initial: "1",
          xs: "2",
          sm: cols === 2 ? "2" : "3",
          md: cols.toString(),
        }}
      >
        {variations.map((v, i) => (
          <Box
            key={i}
            p="5"
            pb="3"
            className={`appbox mb-0 position-relative variation variation${i} with-variation-label`}
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
                        maxChildHeight={maxImageHeight}
                        onClick={(j) => {
                          setOpenCarousel({ variationId: v.id, index: j });
                        }}
                      />
                    ) : (
                      <>
                        {canEditExperiment ? (
                          <>
                            <ScreenshotUpload
                              variation={i}
                              experiment={experiment.id}
                              onSuccess={() => mutate?.()}
                            >
                              {noImageBox()}
                            </ScreenshotUpload>
                          </>
                        ) : (
                          <>{noImageBox()}</>
                        )}
                      </>
                    )}
                  </Box>
                )}
              </Box>
              <Box>
                {hasDescriptions ? <Box>{v.description}</Box> : null}
                {hasUniqueIDs ? (
                  <code className="small">ID: {v.key}</code>
                ) : null}
                <Flex align="center" justify="between">
                  <Box>
                    {experiment.type !== "multi-armed-bandit" &&
                    percentages?.[i] !== undefined ? (
                      <Box>Split: {percentages[i].toFixed(0)}%</Box>
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
                      {canEditExperiment && (
                        <div>
                          <ScreenshotUpload
                            variation={i}
                            experiment={experiment.id}
                            onSuccess={() => mutate?.()}
                          >
                            <Button
                              variant="ghost"
                              style={{ padding: 0, margin: 0 }}
                            >
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
        ))}
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
                    }
                  );

                  if (status >= 400) {
                    throw new Error(
                      message || "There was an error deleting the image"
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
