import { Box, Flex, Dialog, ScrollArea, Separator } from "@radix-ui/themes";
import { Responsive } from "@radix-ui/themes/dist/esm/props/prop-def.js";
import {
  createContext,
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

export type Size = SharedSize<"md" | "lg"> | "xl" | "fill";

// Modal does not use the shared Radix map. Radix Dialog's size drives padding
// and border radius rather than a step on the control scale, its own default is
// "3", and the visible width comes from getMaxWidth below. So md is Radix "3"
// here where it is "2" everywhere else.
function getRadixSize(size: Size): Responsive<"3" | "4"> {
  switch (size) {
    case "md":
      return "3";
    case "lg":
    case "xl":
    case "fill":
      return "4";
  }
}

function getMaxWidth(size: Size) {
  switch (size) {
    case "md":
      return "500px";
    case "lg":
      return "800px";
    case "xl":
      return "1100px";
    case "fill":
      return "calc(100vw - 32px)";
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

  const ctx = useMemo<ModalContextValue>(
    () => ({
      error,
      setError,
      scrollBodyToTop,
      bodyRef,
      sendTrackingEvent,
      loading,
      setLoading,
    }),
    [error, scrollBodyToTop, sendTrackingEvent, loading],
  );

  const ariaDescribedBy = hasDescription
    ? {}
    : { "aria-describedby": undefined };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        ref={contentRef}
        size={getRadixSize(size)}
        maxWidth={getMaxWidth(size)}
        maxHeight={size === "fill" ? "calc(100vh - 32px)" : "85vh"}
        {...ariaDescribedBy}
        onEscapeKeyDown={(e) => {
          // A submit in flight keeps the dialog up even when it is otherwise dismissible.
          if (!dismissible || loading) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (!dismissible || loading) e.preventDefault();
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          // Header, body and footer each carry their own padding.
          padding: 0,
          ...(size === "fill"
            ? {
                width: "calc(100vw - 32px)",
                height: "calc(100vh - 32px)",
              }
            : {}),
        }}
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

function Header({ children }: { children: ReactNode }) {
  return (
    <Flex flexShrink="0" justify="between" align="center" gap="3" pt="6" px="7">
      {children}
    </Flex>
  );
}

function Title({ children }: { children: ReactNode }) {
  return (
    <Dialog.Title size="5" mb="0" style={{ color: "var(--color-text-high)" }}>
      {children}
    </Dialog.Title>
  );
}

function Description({ children }: { children: ReactNode }) {
  return (
    <Box flexShrink="0" px="7" mt="1">
      <Dialog.Description size="3" style={{ color: "var(--color-text-mid)" }}>
        {children}
      </Dialog.Description>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Body — the scrollable content area. The gap above it stays fixed, so content
// scrolls under it rather than up against the title. `padding` is the
// content's inset from the sides and the footer; override it for content that
// needs a different inset, e.g. "0" for full-bleed tables.
//
// Auto-renders an ErrorDisplay when setError has been called on the context,
// so ModalForm consumers get error handling for free.
// ---------------------------------------------------------------------------

function Body({
  children,
  padding = "0 var(--space-7) var(--space-5)",
}: {
  children: ReactNode;
  padding?: string;
}) {
  const { bodyRef, error } = useModalContext();
  return (
    <ScrollArea
      type="auto"
      mt="5"
      ref={bodyRef}
      scrollbars="vertical"
      className={styles.bodyScrollArea}
    >
      <Box className={styles.body} style={{ padding }}>
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
}: {
  children: ReactNode;
  justify?: "start" | "center" | "end" | "between";
}) {
  return (
    <Box flexShrink="0">
      <Separator size="4" />
      <Flex
        gap="3"
        justify={justify}
        // The left inset is short by a ghost button's padding, so a ghost
        // action on the left lines up with the content.
        style={{
          padding:
            "20px var(--space-7) 20px calc(var(--space-7) - var(--space-3))",
        }}
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
