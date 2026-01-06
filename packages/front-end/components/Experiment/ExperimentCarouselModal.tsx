import { FC, useState, useCallback, useEffect, useMemo } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Box, Flex, Text } from "@radix-ui/themes";
import { MdArrowBackIosNew, MdArrowForwardIos } from "react-icons/md";
import { PiCameraSlashLight } from "react-icons/pi";
import Modal from "@/components/Modal";
import AuthorizedImage from "@/components/AuthorizedImage";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import styles from "./ExperimentCarouselModal.module.scss";

const ExperimentCarouselModal: FC<{
  deleteImage?: (variantId: number, screenshotPath: string) => Promise<void>;
  experiment: ExperimentInterfaceStringDates;
  currentVariation: string;
  currentScreenshot: number;
  imageCache: Record<string, { url: string; expiresAt: string }>;
  close: () => void;
  mutate?: () => void;
  restrictVariation?: boolean;
}> = ({
  deleteImage,
  experiment,
  currentVariation,
  currentScreenshot,
  imageCache,
  close,
  mutate,
  restrictVariation = false,
}) => {
  const [variantId, setVariationId] = useState(currentVariation);
  const [screenshotIndex, setScreenshotIndex] = useState(currentScreenshot);
  const [zoom, setZoom] = useState(false);

  // loop through all experiment variations and get a map of all screenshots, with the variant id and info
  const variantMap = useMemo(() => {
    return new Map(
      experiment.variations.map((v, i) => [v.id, { ...v, index: i }]),
    );
  }, [experiment.variations]);
  const orderedVariants = experiment.variations;
  const getScreenshot = useCallback(
    (variantId: string, screenshotIndex: number) => {
      const variant = variantMap.get(variantId);
      if (!variant) return null;

      return variant.screenshots[screenshotIndex] || null;
    },
    [variantMap],
  );

  const getNextScreenshot = useCallback(
    (variantId: string, screenshotIndex: number) => {
      const variantIndex = orderedVariants.findIndex((v) => v.id === variantId);
      if (variantIndex === -1) return null;

      const variant = orderedVariants[variantIndex];

      // Move within current variant
      if (screenshotIndex + 1 < variant.screenshots.length) {
        return {
          screenshot: variant.screenshots[screenshotIndex + 1],
          screenshotIndex: screenshotIndex + 1,
          variantId,
        };
      }

      if (restrictVariation) {
        return null; // No next screenshot if restricted
      }

      // Move to the next variant
      let nextVariantIndex = variantIndex + 1;
      while (nextVariantIndex < orderedVariants.length) {
        const nextVariant = orderedVariants[nextVariantIndex];
        if (nextVariant.screenshots.length > 0) {
          return {
            screenshot: nextVariant.screenshots[0],
            screenshotIndex: 0,
            variantId: nextVariant.id,
          };
        }
        nextVariantIndex++;
      }

      return null; // No more screenshots
    },
    [orderedVariants, restrictVariation],
  );

  const getPreviousScreenshot = useCallback(
    (variantId: string, screenshotIndex: number) => {
      let variantIndex = orderedVariants.findIndex((v) => v.id === variantId);
      if (variantIndex === -1) return null;

      const variant = orderedVariants[variantIndex];

      // Move within current variant
      if (screenshotIndex > 0) {
        return {
          screenshot: variant.screenshots[screenshotIndex - 1],
          screenshotIndex: screenshotIndex - 1,
          variantId,
        };
      }

      if (restrictVariation) {
        return null; // No previous screenshot if restricted
      }

      // Move to the previous variant with screenshots
      while (variantIndex > 0) {
        variantIndex--;
        const prevVariant = orderedVariants[variantIndex];
        if (prevVariant.screenshots.length > 0) {
          return {
            screenshot:
              prevVariant.screenshots[prevVariant.screenshots.length - 1],
            screenshotIndex: prevVariant.screenshots.length - 1,
            variantId: prevVariant.id,
          };
        }
      }

      return null; // No previous screenshots
    },
    [orderedVariants, restrictVariation],
  );

  const variant = variantMap.get(variantId);
  const variantIndex = variant?.index;
  const screenshot = getScreenshot(variantId, screenshotIndex);
  const nextScreenshot = getNextScreenshot(variantId, screenshotIndex);
  const prevScreenshot = getPreviousScreenshot(variantId, screenshotIndex);

  const goToPrevious = useCallback(() => {
    if (prevScreenshot) {
      setScreenshotIndex(prevScreenshot.screenshotIndex);
      if (prevScreenshot.variantId !== variantId) {
        setVariationId(prevScreenshot.variantId);
      }
    }
  }, [prevScreenshot, variantId]);

  const goToNext = useCallback(() => {
    if (nextScreenshot) {
      setScreenshotIndex(nextScreenshot.screenshotIndex);
      if (nextScreenshot.variantId !== variantId) {
        setVariationId(nextScreenshot.variantId);
      }
    }
  }, [nextScreenshot, variantId]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event) => {
      if (event.key === "ArrowLeft") {
        goToPrevious();
      } else if (event.key === "ArrowRight") {
        goToNext();
      } else if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [prevScreenshot, nextScreenshot, goToPrevious, goToNext, close]);

  if (!variant || !screenshot) return null;

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      header={null}
      close={close}
      bodyClassName="d-flex justify-content-center align-items-center"
      size="max"
      sizeY="max"
      hideCta={true}
    >
      <Flex direction="column" gap="2" height="100%" width="100%">
        <Flex
          gap="3"
          align="center"
          justify="between"
          flexGrow="1"
          flexShrink="1"
          minHeight="0"
        >
          <Box height="100%" width="40px">
            {prevScreenshot ? (
              <Box className={styles.carouselnav} onClick={goToPrevious}>
                <span className="sr-only">Previous</span>
                <MdArrowBackIosNew />
              </Box>
            ) : null}
          </Box>
          <Box
            flexGrow="1"
            flexShrink="1"
            flexBasis={"100%"}
            height="100%"
            className={styles.imageContainer}
            style={{
              textAlign: "center",
              cursor: zoom ? "zoom-out" : "zoom-in",
              overflow: zoom ? "scroll" : "",
            }}
            onClick={() => setZoom(!zoom)}
          >
            {/* image container */}
            <AuthorizedImage
              imageCache={imageCache}
              className={`experiment-image ${styles.mainimage}`}
              src={screenshot.path}
              key={screenshot.path}
              onErrorMsg={(msg) => {
                return (
                  <Flex
                    title={msg}
                    align="center"
                    justify="center"
                    className="appbox mb-0"
                    width="100%"
                    style={{
                      backgroundColor: "var(--slate-a3)",
                      height: "100%",
                      width: "100%",
                      color: "var(--slate-a9)",
                    }}
                  >
                    <Text size="8">
                      <PiCameraSlashLight />
                    </Text>
                  </Flex>
                );
              }}
              style={{
                width: zoom ? "auto" : "100%",
                height: zoom ? "auto" : "100%",
                objectFit: "contain",
                // these are to center the loading spinner:
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            />
          </Box>
          <Box height="100%" width="40px">
            {nextScreenshot ? (
              <Box onClick={goToNext} className={styles.carouselnav}>
                <span className="sr-only">Next</span>
                <MdArrowForwardIos />
              </Box>
            ) : null}
          </Box>
        </Flex>
        <Flex direction="column" align="center">
          {/* title & description */}
          <h4>{variant.name}</h4>
          <p>{variant.description}</p>
        </Flex>
        <Flex width="100%" align="center" justify="between">
          <Box flexBasis="70px" flexGrow="0"></Box>
          <Flex gap="2" justify="center" wrap="wrap" flexBasis="100%">
            {orderedVariants.map((variant, variantIndex) =>
              variant.screenshots.length > 0 &&
              (!restrictVariation || variant.id === variantId)
                ? variant.screenshots.map((screenshot, index) => (
                    <Box
                      key={`${variant.id}-${index}`}
                      onClick={() => {
                        setVariationId(variant.id);
                        setScreenshotIndex(index);
                      }}
                      style={{
                        cursor: "pointer",
                        borderRadius: "5px",
                        border:
                          variant.id === variantId && screenshotIndex === index
                            ? "2px solid var(--text-link-color)"
                            : "2px solid transparent",
                      }}
                      title={`${variant.name} - screenshot ${index + 1}`}
                    >
                      <Box
                        className={`variation variation${variantIndex} with-small-border`}
                        style={{ borderRadius: "4px", overflow: "hidden" }}
                      >
                        <AuthorizedImage
                          imageCache={imageCache}
                          src={screenshot.path}
                          onErrorMsg={(msg) => {
                            return (
                              <Flex
                                title={msg}
                                align="center"
                                justify="center"
                                className="appbox mb-0"
                                width="100%"
                                style={{
                                  backgroundColor: "var(--slate-a3)",
                                  height: "46px",
                                  width: "50px",
                                  color: "var(--slate-a9)",
                                }}
                              >
                                <Text size="8">
                                  <PiCameraSlashLight />
                                </Text>
                              </Flex>
                            );
                          }}
                          style={{
                            width: "50px",
                            height: "46px",
                            textAlign: "center",
                            objectFit: "cover",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        />
                      </Box>
                    </Box>
                  ))
                : null,
            )}
          </Flex>
          <Box flexBasis="70px" flexGrow="0">
            {deleteImage && (
              <DeleteButton
                displayName="Screenshot"
                text="Delete"
                onClick={async () => {
                  if (variantIndex == null) return;
                  await deleteImage(variantIndex, screenshot.path);
                  if (mutate) {
                    mutate();
                    if (prevScreenshot) {
                      goToPrevious();
                    } else if (nextScreenshot) {
                      goToNext();
                    } else {
                      close();
                    }
                  } else {
                    close();
                  }
                }}
                useRadix={true}
              />
            )}
          </Box>
        </Flex>
      </Flex>
    </Modal>
  );
};

export default ExperimentCarouselModal;
