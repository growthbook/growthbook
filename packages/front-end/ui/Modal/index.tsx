import {
  Box,
  Flex,
  Inset,
  Dialog,
  ScrollArea,
  Separator,
} from "@radix-ui/themes";
import { Responsive } from "@radix-ui/themes/dist/esm/props/prop-def.js";
import {
  createContext,
  CSSProperties,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { v4 as uuidv4 } from "uuid";
import track, { TrackEventProps } from "@/services/track";
import { Size as SharedSize } from "@/ui/sizes";
import ErrorDisplay from "../ErrorDisplay";
import styles from "./Modal.module.scss";

// Main's sizes plus two from the experiment Setup page redesign:
// "640", a literal-pixel size for content meaningfully narrower than "lg"
// (800px) but wider than "md" (500px); and "full", which fills the window
// but for 120px at each side and 74px above and below (the Setup page's
// JSON value editor).
export type Size = SharedSize<"md" | "lg"> | "640" | "xl" | "fill" | "full";

// Modal does not use the shared Radix map. Radix Dialog's size drives padding
// and border radius rather than a step on the control scale, its own default is
// "3", and the visible width comes from getMaxWidth below. So md is Radix "3"
// here where it is "2" everywhere else.
function getRadixSize(size: Size): Responsive<"3" | "4"> {
  switch (size) {
    case "md":
    case "640":
      return "3";
    case "lg":
    case "xl":
    case "fill":
    case "full":
      return "4";
  }
}

// "full": the window's height less 74px above and below.
const FULL_HEIGHT = "calc(100vh - 148px)";

function getMaxWidth(size: Size) {
  switch (size) {
    case "md":
      return "500px";
    case "640":
      return "640px";
    case "lg":
      return "800px";
    case "xl":
      return "1100px";
    case "fill":
      return "calc(100vw - 32px)";
    case "full":
      return "calc(100vw - var(--app-rail-width, 240px))";
  }
}

// ---------------------------------------------------------------------------
// Context shared between primitives.
//
// Modal.Root owns error + tracking state and exposes it here so that
// Modal.Body can render an error automatically, and the ModalForm wrapper
// (in ui/Modal/Patterns) can report submit outcomes without the consumer
// wiring anything up.
// ---------------------------------------------------------------------------

type ModalContextValue = {
  error: string | null;
  setError: (error: string | null) => void;
  scrollBodyToTop: () => void;
  bodyRef: React.RefObject<HTMLDivElement>;
  sendTrackingEvent: (
    eventName: string,
    additionalProps?: Record<string, unknown>,
  ) => void;
  // True while a ModalForm submit is in flight. Root uses it to block dismiss.
  loading: boolean;
  setLoading: (loading: boolean) => void;
  // Closes the modal through Root, so a fadeIn modal plays its fade-out
  // before it's closed (and, usually, unmounted by its host).
  requestClose: () => void;
};

const ModalContext = createContext<ModalContextValue | null>(null);

export function useModalContext(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) {
    throw new Error("Modal primitives must be rendered inside <Modal.Root>.");
  }
  return ctx;
}

export function useOptionalModalContext(): ModalContextValue | null {
  return useContext(ModalContext);
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export type TrackingEventModalProps = {
  // An empty string disables tracking, but the prop is still required to
  // encourage developers to add it.
  trackingEventModalType: string;
  // The source (likely page or component) causing the modal to be shown
  trackingEventModalSource?: string;
  // The allowlist for valid tracking props is managed outside of this repo.
  // Make sure anything passed here is on that list.
  allowlistedTrackingEventProps?: TrackEventProps;
};
type RootProps = TrackingEventModalProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: Size;
  dismissible?: boolean;
  hasDescription?: boolean;
  // The space at the dialog's sides, in place of 40px: its left padding,
  // and the header's, body's and footer's right padding (where the body's
  // scrollbar sits). Optional and additive.
  paddingX?: string;
  // The header's and footer's dividers' colour, in place of Radix's
  // separator grey (--gray-a6). Optional and additive.
  dividerColor?: string;
  // A slower, softer entrance (set in review; the redesigned experiment
  // pages' modals): see .fadeIn in Modal.module.scss. Optional and additive.
  fadeIn?: boolean;
  // A class on the dialog itself, for hosts that style it (e.g. to name it
  // for a page transition). Optional and additive.
  contentClassName?: string;
  children: ReactNode;
};

function Root({
  open,
  onOpenChange,
  size = "md",
  dismissible = false,
  hasDescription = true,
  trackingEventModalType,
  trackingEventModalSource,
  allowlistedTrackingEventProps = {},
  paddingX = "40px",
  dividerColor,
  fadeIn = false,
  contentClassName,
  children,
}: RootProps) {
  const [modalUuid] = useState(uuidv4());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const scrollBodyToTop = useCallback(() => {
    setTimeout(() => {
      if (bodyRef.current) {
        bodyRef.current.scrollTo({ top: 0, behavior: "smooth" });
      }
    }, 50);
  }, []);

  const sendTrackingEvent = useCallback(
    (eventName: string, additionalProps?: Record<string, unknown>) => {
      if (trackingEventModalType === "") {
        return;
      }
      track(eventName, {
        type: trackingEventModalType,
        source: trackingEventModalSource,
        eventGroupUuid: modalUuid,
        ...allowlistedTrackingEventProps,
        ...(additionalProps || {}),
      });
    },
    [
      trackingEventModalType,
      trackingEventModalSource,
      allowlistedTrackingEventProps,
      modalUuid,
    ],
  );

  const prevOpenRef = useRef(false);
  useEffect(() => {
    const prevOpen = prevOpenRef.current;
    prevOpenRef.current = open;

    if (open && !prevOpen) {
      sendTrackingEvent("modal-open");
    } else if (!open && prevOpen) {
      setError(null);
      setLoading(false);
    }
  }, [open, sendTrackingEvent]);

  // fadeIn: closing plays the fade-out first (Modal.module.scss), then tells
  // the host. Hosts unmount a closed modal straight away, which would cut the
  // animation off, so the dialog closes itself here and the host hears
  // about it once the fade has run. Instant for reduced motion.
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => {
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!fadeIn || reducedMotion) {
      onOpenChange(false);
      return;
    }
    setClosing(true);
    window.setTimeout(() => onOpenChange(false), 320);
  }, [fadeIn, onOpenChange]);
  // Reopened by its host: ready to close again.
  useEffect(() => {
    if (open) setClosing(false);
  }, [open]);

  const ctx = useMemo<ModalContextValue>(
    () => ({
      error,
      setError,
      scrollBodyToTop,
      bodyRef,
      sendTrackingEvent,
      loading,
      setLoading,
      requestClose,
    }),
    [error, scrollBodyToTop, sendTrackingEvent, loading, requestClose],
  );

  const ariaDescribedBy = hasDescription
    ? {}
    : { "aria-describedby": undefined };

  return (
    <Dialog.Root
      open={open && !closing}
      onOpenChange={(nextOpen) =>
        nextOpen ? onOpenChange(true) : requestClose()
      }
    >
      <Dialog.Content
        ref={contentRef}
        className={
          [fadeIn ? styles.fadeIn : "", contentClassName ?? ""]
            .filter(Boolean)
            .join(" ") || undefined
        }
        size={getRadixSize(size)}
        maxWidth={getMaxWidth(size)}
        maxHeight={
          size === "fill"
            ? "calc(100vh - 32px)"
            : size === "full"
              ? FULL_HEIGHT
              : "85vh"
        }
        // "full" is a fixed size, not just a cap.
        {...(size === "full"
          ? { width: getMaxWidth(size), height: FULL_HEIGHT }
          : {})}
        {...ariaDescribedBy}
        onEscapeKeyDown={(e) => {
          // A submit in flight keeps the dialog up even when it is otherwise dismissible.
          if (!dismissible || loading) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (!dismissible || loading) e.preventDefault();
        }}
        style={
          {
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            paddingTop: size === "fill" ? "0" : "32px",
            paddingLeft: size === "fill" ? "0" : paddingX,
            "--modal-padding-x": paddingX,
            paddingRight: "0",
            paddingBottom: size === "fill" ? "0" : "20px",
            ...(size === "fill"
              ? {
                  width: "calc(100vw - 32px)",
                  height: "calc(100vh - 32px)",
                }
              : {}),
            "--inset-padding-left": paddingX,
            ...(dividerColor ? { "--modal-divider-color": dividerColor } : {}),
            // "full" centred in the window. Radix pads its dialogs 32px above
            // but max(32px, 6vh) below, which lifts a window-filling dialog
            // by half the difference; this moves it back down by that much.
            // A relative offset, so it doesn't fight Radix's open animation.
            ...(size === "full"
              ? {
                  top: "calc((max(var(--space-6), 6vh) - var(--space-6)) / 2)",
                }
              : {}),
          } as CSSProperties
        }
      >
        <ModalContext.Provider value={ctx}>{children}</ModalContext.Provider>
      </Dialog.Content>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Header layout primitive.
//
// Renders a fixed-height row at the top of the modal. Children are laid out
// in a space-between flex row so the common pattern of
// <Title /> <SomeAction /> just works
// ---------------------------------------------------------------------------

function Header({
  children,
  divider = false,
}: {
  children: ReactNode;
  // A full-width divider under the header, as the footer's above it, with
  // 28px above and below the header's row (set in review; tried 24px): it's
  // pulled up 4px into the modal's 32px top padding, and the divider sits
  // 28px under it, with the body's 24px below that. With Title's
  // pageHeading, which trims the title to its letters, that's 28px from the
  // top of the capitals and from the baseline. Optional and additive.
  divider?: boolean;
}) {
  const row = (
    <Flex
      flexShrink="0"
      justify="between"
      align="center"
      gap="3"
      style={{ paddingRight: "var(--modal-padding-x, 40px)" }}
    >
      {children}
    </Flex>
  );
  if (!divider) return row;
  return (
    <Box flexShrink="0" style={{ marginTop: "-4px" }}>
      {row}
      <Box ml="-3">
        <Inset side="x">
          <Separator
            size="4"
            style={{
              marginTop: "28px",
              backgroundColor: "var(--modal-divider-color, var(--accent-a6))",
            }}
          />
        </Inset>
      </Box>
    </Box>
  );
}

function Title({
  children,
  pageHeading = false,
}: {
  children: ReactNode;
  /** Styled near a page's heading (@/ui/Heading), two sizes down: 16px
   * (set in review; tried 18px, as by default, and the heading's 20px), at
   * 600 (set in review; tried the heading's 500) in place of
   * Radix's bold, 700, which has no 600 step, in the page text's colour
   * (--text-color-main, which page headings inherit) in place of
   * --color-text-high. Trimmed to the text (cap height to baseline), so
   * the spacing around it is measured from the letters rather than the
   * line's leading (see Header's divider). Off by default. */
  pageHeading?: boolean;
}) {
  return (
    <Dialog.Title
      size={pageHeading ? "4" : "5"}
      trim={pageHeading ? "both" : undefined}
      mb="0"
      style={{
        ...(pageHeading ? { fontWeight: 600 } : {}),
        color: pageHeading
          ? "var(--text-color-main)"
          : "var(--color-text-high)",
      }}
    >
      {children}
    </Dialog.Title>
  );
}

function Description({ children }: { children: ReactNode }) {
  return (
    <Box
      flexShrink="0"
      mt="1"
      style={{ paddingRight: "var(--modal-padding-x, 40px)" }}
    >
      <Dialog.Description size="3" style={{ color: "var(--color-text-mid)" }}>
        {children}
      </Dialog.Description>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Body — the scrollable content area.
//
// Auto-renders an ErrorDisplay when setError has been called on the context,
// so ModalForm consumers get error handling for free.
// ---------------------------------------------------------------------------

function Body({
  children,
  flushBottom = false,
  scrollToEdges = false,
}: {
  children: ReactNode;
  // No space below the body, so its content runs right up to the footer
  // (used with Footer's flushTop). Optional and additive.
  flushBottom?: boolean;
  // The scrolling area reaches the header's divider and the footer's (use
  // with Header's divider and Footer's flushTop), so content scrolls right
  // up to the lines rather than vanishing into a blank band; the space
  // above and below the content moves inside the scroll: 28px above (set
  // in review; tried 32px; 24px without it; off the space scale, so raw)
  // and 40px below, as without it. Optional and additive.
  scrollToEdges?: boolean;
}) {
  const { bodyRef, error } = useModalContext();
  return (
    <ScrollArea
      type="auto"
      mt={scrollToEdges ? "0" : "5"}
      mb={flushBottom || scrollToEdges ? "0" : "3"}
      ml="-1"
      ref={bodyRef}
      scrollbars="vertical"
      className={styles.bodyScrollArea}
      // With scrollToEdges, as wide as the space it's pulled 4px left into
      // (set in review): at width: 100% it stopped 4px short on the right,
      // so its content sat 4px further from the right edge than the left.
      style={
        scrollToEdges ? { width: "calc(100% + var(--space-1))" } : undefined
      }
    >
      <Box
        pl="1"
        pb="1"
        className={styles.body}
        style={{
          paddingRight: "var(--modal-padding-x, 40px)",
          ...(scrollToEdges
            ? { paddingTop: "28px", paddingBottom: "var(--space-7)" }
            : {}),
        }}
      >
        {error && <ErrorDisplay error={error} mb="5" />}
        {children}
      </Box>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Footer — fixed area at the bottom of the modal, preceded by a separator.
//
// Consumers render whatever buttons they need as children.
// ---------------------------------------------------------------------------

function Footer({
  children,
  justify = "end",
  flushTop = false,
}: {
  children: ReactNode;
  justify?: "start" | "center" | "end" | "between";
  // No space above the footer's divider (used with Body's flushBottom).
  // Optional and additive.
  flushTop?: boolean;
}) {
  return (
    <Box flexShrink="0" ml="-3">
      <Inset side="x">
        <Separator
          size="4"
          mt={flushTop ? "0" : "5"}
          style={{
            marginBottom: "20px",
            backgroundColor: "var(--modal-divider-color, var(--accent-a6))",
          }}
        />
      </Inset>
      <Flex
        gap="3"
        justify={justify}
        style={{ paddingRight: "var(--modal-padding-x, 40px)" }}
      >
        {children}
      </Flex>
    </Box>
  );
}

// Re-export the Radix Close so consumers can do
// <Modal.Close asChild><Button .../></Modal.Close>, or bind to their own
// close handler.
const Close = Dialog.Close;

// ---------------------------------------------------------------------------
// Namespace export.
//
// Consumers use <Modal.Root>, <Modal.Header>, <Modal.Title>, etc. — see
// ui/Modal/Patterns/ModalStandard for a reference composition, and the Base UI
// / Radix Themes Dialog docs for the design intent. Form semantics live in
// ui/Modal/ModalForm; import <ModalForm> from there directly.
// ---------------------------------------------------------------------------

const Modal = {
  Root,
  Header,
  Title,
  Description,
  Body,
  Footer,
  Close,
};

export default Modal;
