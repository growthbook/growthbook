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
import ErrorDisplay from "../ErrorDisplay";
import styles from "./Modal.module.scss";

export type Size = "md" | "lg";

function getRadixSize(size: Size): Responsive<"3" | "4"> {
  switch (size) {
    case "md":
      return "3";
    case "lg":
      return "4";
  }
}

function getMaxWidth(size: Size) {
  switch (size) {
    case "md":
      return "500px";
    case "lg":
      return "800px";
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
};

const ModalContext = createContext<ModalContextValue | null>(null);

export function useModalContext(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) {
    throw new Error("Modal primitives must be rendered inside <Modal.Root>.");
  }
  return ctx;
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
    }
  }, [open, sendTrackingEvent]);

  const ctx = useMemo<ModalContextValue>(
    () => ({
      error,
      setError,
      scrollBodyToTop,
      bodyRef,
      sendTrackingEvent,
    }),
    [error, scrollBodyToTop, sendTrackingEvent],
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
        maxHeight="85vh"
        {...ariaDescribedBy}
        onEscapeKeyDown={(e) => {
          if (!dismissible) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (!dismissible) e.preventDefault();
        }}
        style={
          {
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            paddingTop: "32px",
            paddingLeft: "40px",
            paddingRight: "0",
            paddingBottom: "20px",
            "--inset-padding-left": "40px",
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

function Header({ children }: { children: ReactNode }) {
  return (
    <Flex flexShrink="0" justify="between" align="center" gap="3" pr="7">
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
    <Box flexShrink="0" pr="7" mt="1">
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

function Body({ children }: { children: ReactNode }) {
  const { bodyRef, error } = useModalContext();
  return (
    <ScrollArea type="auto" mt="5" mb="3" ml="-1" ref={bodyRef}>
      <Box pr="7" pl="1" className={styles.body}>
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
    <Box flexShrink="0" ml="-3">
      <Inset side="x">
        <Separator size="4" mt="5" style={{ marginBottom: "20px" }} />
      </Inset>
      <Flex gap="3" justify={justify} pr="7">
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
