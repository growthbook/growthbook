import { FC, useState, useCallback, useEffect, useMemo } from "react";
import { getLatestPhaseVariations } from "shared/experiments";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Box, Flex, Text } from "@radix-ui/themes";
import { MdArrowBackIosNew, MdArrowForwardIos } from "react-icons/md";
import { PiCameraSlashLight } from "react-icons/pi";
import Modal from "@/ui/Modal";
import AuthorizedImage from "@/components/AuthorizedImage";
import Button from "@/ui/Button";
import VariationLabel from "@/ui/VariationLabel";
import styles from "./ExperimentCarouselModal.module.scss";

// Wide enough for the Close button, and reserved on both sides so the
// thumbnail strip sits in the middle of the footer.
const CLOSE_SLOT = "72px";

const ExperimentCarouselModal: FC<{
  experiment: ExperimentInterfaceStringDates;
  currentVariation: string;
  currentScreenshot: number;
  imageCache: Record<string, { url: string; expiresAt: string }>;
  close: () => void;
  restrictVariation?: boolean;
}> = ({
  experiment,
  currentVariation,
  currentScreenshot,
  imageCache,
  close,
  restrictVariation = false,
}) => {
  const [variantId, setVariationId] = useState(currentVariation);
  const [screenshotIndex, setScreenshotIndex] = useState(currentScreenshot);

  // loop through all experiment variations and get a map of all screenshots, with the variant id and info
  const orderedVariants = getLatestPhaseVariations(experiment);
  const variantMap = useMemo(() => {
    return new Map(orderedVariants.map((v) => [v.id, v]));
  }, [orderedVariants]);
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
    // Radix-based so it can open from inside another Radix dialog; the legacy
    // modal portals underneath one and the image would render behind it.
    <Modal.Root
      open={true}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      size="max"
      padding="even"
      dismissible
      showCloseButton
      hasDescription={false}
      trackingEventModalType=""
    >
      {/* Radix labels the dialog by its title; this viewer shows none. */}
      <div className="sr-only">
        <Modal.Title>Screenshots</Modal.Title>
      </div>
      <Flex direction="column" gap="2" height="100%" width="100%" minHeight="0">
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
                <MdArrowBackIosNew size={22} />
              </Box>
            ) : null}
          </Box>
          <Box
            flexGrow="1"
            flexShrink="1"
            flexBasis={"100%"}
            height="100%"
            className={styles.imageContainer}
            style={{ textAlign: "center" }}
          >
            {/* image container */}
            <AuthorizedImage
              imageCache={imageCache}
              className="experiment-image"
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
                width: "100%",
                height: "100%",
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
                <MdArrowForwardIos size={22} />
              </Box>
            ) : null}
          </Box>
        </Flex>
        <Flex direction="column" align="center">
          <VariationLabel
            number={orderedVariants.findIndex((v) => v.id === variantId)}
            name={variant.name}
            size="lg"
          />
        </Flex>
      </Flex>
      <Modal.Footer justify="between" align="center">
        {/* Mirrors the Close slot, so the strip centres on the footer rather
            than on whatever space is left beside the button. */}
        <Box width={CLOSE_SLOT} flexShrink="0" />
        <Flex
          gap="4"
          align="center"
          wrap="wrap"
          justify="center"
          flexGrow="1"
          minWidth="0"
        >
          {orderedVariants.map((variant) =>
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
                      boxShadow:
                        variant.id === variantId && screenshotIndex === index
                          ? "0 0 0 2px var(--violet-9)"
                          : "0 0 0 2px var(--slate-a6)",
                    }}
                    title={`${variant.name} - screenshot ${index + 1}`}
                  >
                    <Box
                      style={{
                        borderRadius: "4px",
                        overflow: "hidden",
                        // Not the variation colour: the ring already says which
                        // thumbnail is selected, and a tinted mat behind a
                        // screenshot reads as part of the image.
                        background: "var(--slate-a3)",
                      }}
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
        <Flex width={CLOSE_SLOT} flexShrink="0" justify="end">
          <Modal.Close>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
          </Modal.Close>
        </Flex>
      </Modal.Footer>
    </Modal.Root>
  );
};

export default ExperimentCarouselModal;
