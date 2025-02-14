import {
  ExperimentInterfaceStringDates,
  Variation,
} from "back-end/types/experiment";
import { FC } from "react";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { PiCameraLight, PiCameraPlusLight } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { trafficSplitPercentages } from "@/services/utils";
import Carousel from "@/components/Carousel";
import ScreenshotUpload from "@/components/EditExperiment/ScreenshotUpload";
import AuthorizedImage from "@/components/AuthorizedImage";
import Button from "@/components/Radix/Button";

const imageCache = {};

const ScreenshotCarousel: FC<{
  index: number;
  variation: Variation;
  canEditExperiment: boolean;
  experiment: ExperimentInterfaceStringDates;
  mutate?: () => void;
  maxChildHeight?: number;
}> = ({
  canEditExperiment,
  experiment,
  index,
  variation,
  mutate,
  maxChildHeight,
}) => {
  const { apiCall } = useAuth();

  return (
    <Carousel
      deleteImage={
        !canEditExperiment
          ? undefined
          : async (j) => {
              const { status, message } = await apiCall<{
                status: number;
                message?: string;
              }>(`/experiment/${experiment.id}/variation/${index}/screenshot`, {
                method: "DELETE",
                body: JSON.stringify({
                  url: variation.screenshots[j].path,
                }),
              });

              if (status >= 400) {
                throw new Error(
                  message || "There was an error deleting the image"
                );
              }

              mutate?.();
            }
      }
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
  const { variations } = experiment;
  const phases = experiment.phases || [];
  const lastPhaseIndex = phases.length - 1;
  const lastPhase = phases[lastPhaseIndex];
  const weights = lastPhase?.variationWeights ?? null;
  const percentages =
    (weights?.length || 0) > 0 ? trafficSplitPercentages(weights) : null;

  const hasDescriptions = variations.some((v) => !!v.description?.trim());
  const hasUniqueIDs = variations.some((v, i) => v.key !== i + "");
  const hasAnyImages = variations.some((v) => v.screenshots.length > 0);

  // set some variables for the display of the component - could make options
  const cols = variations.length > 6 ? 4 : 3;
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
      <Flex gap={gap} wrap="wrap" direction={{ initial: "column", sm: "row" }}>
        {variations.map((v, i) => (
          <Box
            key={i}
            p="5"
            pb="3"
            flexGrow="0"
            flexShrink="1"
            flexBasis={{
              // This might be a bit confusing, but 'gap' in flex box is not included in the flex basis width,
              // which means percentages can't just be a simple division.
              // This checks and does the math to make it fix perfectly
              initial: `calc(100% / ${cols} - var(--space-${gap}) / ${cols} * (${cols} - 1))`,
              sm: `calc(100% / ${cols - 1} - var(--space-${gap}) / ${
                cols - 1
              } * (${cols - 1} - 1))`,
              md: `calc(100% / ${cols} - var(--space-${gap}) / ${cols} * (${cols} - 1))`,
            }}
            className={`appbox mb-0 position-relative variation variation${i} with-variation-label`}
            style={{ backgroundColor: "var(--white-a1)" }}
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
            <Flex gap="2" direction="column" justify="between">
              <Box>
                <Box mb="2">
                  <Flex gap="4">
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
                    <Flex>
                      {v.screenshots.length > 0 ? (
                        <ScreenshotCarousel
                          key={i}
                          index={i}
                          variation={v}
                          canEditExperiment={canEditExperiment}
                          experiment={experiment}
                          mutate={mutate}
                          maxChildHeight={maxImageHeight}
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
                    </Flex>
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
      </Flex>
    </Box>
  );
};

export default VariationsTable;
