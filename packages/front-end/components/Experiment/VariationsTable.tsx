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
  mutate?: () => void;
}

const VariationsTable: FC<Props> = ({
  experiment,
  canEditExperiment,
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

  return (
    <Box mx="4">
      <Flex gap="4">
        {variations.map((v, i) => (
          <Box
            key={i}
            p="5"
            pb="4"
            flexGrow="1"
            flexShrink="1"
            flexBasis="0"
            className={`appbox position-relative variation variation${i} with-variation-label`}
            style={{ backgroundColor: "var(--white-a1)", maxWidth: "33%" }}
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
            <Flex gap="2" direction="column">
              <Box>
                <Flex gap="4">
                  <Box className="">
                    <span className="circle-label label">{i}</span>
                  </Box>
                  <Heading as="h4" size="3">
                    {v.name}
                  </Heading>
                </Flex>
              </Box>
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
                      maxChildHeight={200}
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
                            <Flex
                              align="center"
                              justify="center"
                              className="appbox"
                              width="100%"
                              style={{
                                backgroundColor: "var(--slate-a3)",
                                height: "148px",
                                color: "var(--slate-a9)",
                              }}
                            >
                              <Text size="8">
                                <PiCameraPlusLight />
                              </Text>
                            </Flex>
                          </ScreenshotUpload>
                        </>
                      ) : (
                        <Flex
                          align="center"
                          justify="center"
                          className="appbox"
                          width="100%"
                          style={{
                            backgroundColor: "var(--slate-a3)",
                            height: "148px",
                            color: "var(--slate-a9)",
                          }}
                        >
                          <Text size="8">
                            <PiCameraLight />
                          </Text>
                        </Flex>
                      )}
                    </>
                  )}
                </Flex>
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
                  <Flex align="center" justify="end" gap="2">
                    {v.screenshots.length > 0 ? (
                      <>
                        {v.screenshots.length} image
                        {v.screenshots.length > 1 ? "s" : ""}
                      </>
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
                            Add
                          </Button>
                        </ScreenshotUpload>
                      </div>
                    )}
                  </Flex>
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
