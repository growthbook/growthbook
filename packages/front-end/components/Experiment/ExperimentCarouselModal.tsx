import { FC, useState, useEffect, useRef, CSSProperties } from "react";
import clsx from "clsx";
import { getLatestPhaseVariations } from "shared/experiments";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Box, Flex, VisuallyHidden } from "@radix-ui/themes";
import { PiCameraSlashLight, PiCaretLeft, PiCaretRight } from "react-icons/pi";
import Modal from "@/ui/Modal";
import AuthorizedImage from "@/components/AuthorizedImage";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import VariationNumber from "@/ui/VariationNumber";
import styles from "./ExperimentCarouselModal.module.scss";

type Shot = { variantId: string; index: number };

const unavailable = (msg: string, iconSize: CSSProperties["fontSize"]) => (
  <Flex
    title={msg}
    align="center"
    justify="center"
    width="100%"
    height="100%"
    style={{
      backgroundColor: "var(--slate-a3)",
      color: "var(--slate-a9)",
      fontSize: iconSize,
    }}
  >
    <PiCameraSlashLight />
  </Flex>
);

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
  const variants = getLatestPhaseVariations(experiment).filter(
    (v) =>
      v.screenshots.length > 0 &&
      (!restrictVariation || v.id === currentVariation),
  );
  // Every screenshot in the strip's order, which the arrows step through.
  const shots: Shot[] = variants.flatMap((v) =>
    v.screenshots.map((_, index) => ({ variantId: v.id, index })),
  );
  const [current, setCurrent] = useState<Shot>({
    variantId: currentVariation,
    index: currentScreenshot,
  });
  const position = shots.findIndex(
    (s) => s.variantId === current.variantId && s.index === current.index,
  );
  const prev = position > 0 ? shots[position - 1] : null;
  const next =
    position >= 0 && position < shots.length - 1 ? shots[position + 1] : null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && prev) setCurrent(prev);
      else if (event.key === "ArrowRight" && next) setCurrent(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [prev, next]);

  // The strip keeps the shown screenshot in view as the arrows move on.
  const activeThumb = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeThumb.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [position]);

  const variant = variants.find((v) => v.id === current.variantId);
  const screenshot = variant?.screenshots[current.index];
  if (!variant || !screenshot) return null;

  return (
    // Radix, so it can open above another Radix dialog; the legacy modal
    // renders behind one.
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
      // Focus the viewer itself rather than its close button: nothing to type
      // into, and the arrows and Escape work from anywhere.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement | null)?.focus();
      }}
      trackingEventModalType=""
    >
      {/* Radix labels the dialog by its title; this viewer shows none. */}
      <VisuallyHidden>
        <Modal.Title>Screenshots</Modal.Title>
      </VisuallyHidden>
      <Flex direction="column" gap="4" height="100%" minHeight="0">
        {/* Clear of the corner close button. */}
        <Flex align="center" gap="3" pr="8" style={{ minHeight: 32 }}>
          <Box minWidth="0">
            <VariationLabel
              number={variant.index}
              name={variant.name}
              size="lg"
            />
          </Box>
          {shots.length > 1 ? (
            <Text color="text-mid" whiteSpace="nowrap">
              {position + 1} of {shots.length}
            </Text>
          ) : null}
        </Flex>

        {/* The arrows keep gutters of their own, clear of a wide image. */}
        <Flex align="center" gap="3" flexGrow="1" minHeight="0">
          <Flex className={styles.gutter}>
            {prev ? (
              <button
                type="button"
                aria-label="Previous screenshot"
                className={styles.nav}
                onClick={() => setCurrent(prev)}
              >
                <PiCaretLeft size={20} />
              </button>
            ) : null}
          </Flex>
          <Box flexGrow="1" height="100%" minWidth="0">
            <AuthorizedImage
              imageCache={imageCache}
              src={screenshot.path}
              key={screenshot.path}
              onErrorMsg={(msg) => unavailable(msg, "48px")}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                // Centres the loading spinner.
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            />
          </Box>
          <Flex className={styles.gutter}>
            {next ? (
              <button
                type="button"
                aria-label="Next screenshot"
                className={styles.nav}
                onClick={() => setCurrent(next)}
              >
                <PiCaretRight size={20} />
              </button>
            ) : null}
          </Flex>
        </Flex>

        {shots.length > 1 ? (
          <Flex gap="5" className={styles.strip}>
            {variants.map((v) => (
              <Flex key={v.id} align="center" gap="2" flexShrink="0">
                {restrictVariation ? null : (
                  <VariationNumber number={v.index} />
                )}
                {v.screenshots.map((s, index) => {
                  const active =
                    v.id === current.variantId && index === current.index;
                  return (
                    <button
                      key={s.path}
                      ref={active ? activeThumb : undefined}
                      type="button"
                      aria-label={`${v.name}, screenshot ${index + 1}`}
                      aria-current={active || undefined}
                      className={clsx(styles.thumb, active && styles.active)}
                      onClick={() => setCurrent({ variantId: v.id, index })}
                    >
                      <AuthorizedImage
                        imageCache={imageCache}
                        src={s.path}
                        onErrorMsg={(msg) => unavailable(msg, "20px")}
                      />
                    </button>
                  );
                })}
              </Flex>
            ))}
          </Flex>
        ) : null}
      </Flex>
    </Modal.Root>
  );
};

export default ExperimentCarouselModal;
