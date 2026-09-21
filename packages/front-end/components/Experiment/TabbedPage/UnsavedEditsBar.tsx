import { useEffect, useRef } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import { useExperimentEdits } from "./ExperimentEdits";
import styles from "./UnsavedEditsBar.module.scss";

/**
 * Fires when the bar appears, resizes or goes away. Anything sized against the
 * viewport listens, since a CSS variable alone cannot tell it to re-measure.
 */
export const SAVE_BAR_RESIZE_EVENT = "gb:save-bar-resize";

/** Appears once something on the page is edited, and is the only way to write it. */
export default function UnsavedEditsBar() {
  const edits = useExperimentEdits();
  const bar = useRef<HTMLDivElement>(null);
  const shown = !!edits?.dirty;

  // Anything anchored to the bottom of the page sits above this bar, so its
  // height is published rather than guessed.
  useEffect(() => {
    const root = document.documentElement;
    const el = bar.current;
    if (!shown || !el) {
      root.style.setProperty("--experiment-save-bar-height", "0px");
      window.dispatchEvent(new Event(SAVE_BAR_RESIZE_EVENT));
      return;
    }
    const publish = () => {
      root.style.setProperty(
        "--experiment-save-bar-height",
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
      window.dispatchEvent(new Event(SAVE_BAR_RESIZE_EVENT));
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.setProperty("--experiment-save-bar-height", "0px");
      window.dispatchEvent(new Event(SAVE_BAR_RESIZE_EVENT));
    };
  }, [shown]);

  if (!shown) return null;

  return (
    <div className={styles.bar} ref={bar}>
      <Box
        mx="auto"
        width="100%"
        style={{ maxWidth: "var(--page-content-max-width)" }}
      >
        <Flex align="center" justify="end" gap="3">
          {edits.error ? (
            <HelperText status="error" size="sm">
              {edits.error}
            </HelperText>
          ) : null}
          <Button
            variant="ghost"
            color="gray"
            disabled={edits.saving}
            onClick={edits.discardAll}
          >
            Discard Changes
          </Button>
          <Button disabled={edits.saving} onClick={() => edits.saveAll()}>
            {edits.saving ? "Saving..." : "Save"}
          </Button>
        </Flex>
      </Box>
    </div>
  );
}
