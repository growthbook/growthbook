import {
  Box,
  Flex,
  Inset,
  Dialog as RadixDialog,
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
import ErrorDisplay from "./ErrorDisplay";
import Text from "./Text";

export type Size = "md" | "lg";

export function getRadixSize(size: Size): Responsive<"3" | "4"> {
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
// Dialog.Root owns error + tracking state and exposes it here so that
// Dialog.Body can render an error automatically, and the DialogForm wrapper
// (in components/Dialog) can report submit outcomes without the consumer
// wiring anything up.
// ---------------------------------------------------------------------------

type DialogContextValue = {
  size: Size;
  error: string | null;
  setError: (error: string | null) => void;
  scrollBodyToTop: () => void;
  bodyRef: React.RefObject<HTMLDivElement>;
  sendTrackingEvent: (
    eventName: string,
    additionalProps?: Record<string, unknown>,
  ) => void;
};

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialogContext(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error("Dialog primitives must be rendered inside <Dialog.Root>.");
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
  children: ReactNode;
};

function Root({
  open,
  onOpenChange,
  size = "md",
  trackingEventModalType,
  trackingEventModalSource,
  allowlistedTrackingEventProps = {},
  children,
}: RootProps) {
  const [modalUuid] = useState(uuidv4());
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (open) {
      sendTrackingEvent("modal-open");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ctx = useMemo<DialogContextValue>(
    () => ({
      size,
      error,
      setError,
      scrollBodyToTop,
      bodyRef,
      sendTrackingEvent,
    }),
    [size, error, scrollBodyToTop, sendTrackingEvent],
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setError(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={handleOpenChange}>
      <RadixDialog.Content
        size={getRadixSize(size)}
        maxWidth={getMaxWidth(size)}
        maxHeight="85vh"
        style={
          {
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            paddingTop: "32px",
            paddingLeft: "40px",
            paddingRight: "40px",
            paddingBottom: "24px",
            "--inset-padding-left": "40px",
            "--inset-padding-right": "40px",
          } as CSSProperties
        }
      >
        <DialogContext.Provider value={ctx}>{children}</DialogContext.Provider>
      </RadixDialog.Content>
    </RadixDialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Header layout primitive.
//
// Renders a fixed-height row at the top of the dialog. Children are laid out
// in a space-between flex row so the common pattern of
// <Title /> <SomeAction /> just works — no HeaderAction prop required.
// ---------------------------------------------------------------------------

function Header({ children }: { children: ReactNode }) {
  return (
    <Flex py="2" flexShrink="0" justify="between" align="center" gap="3" mb="1">
      {children}
    </Flex>
  );
}

function Title({ children }: { children: ReactNode }) {
  return (
    <RadixDialog.Title size="5" mb="0">
      {children}
    </RadixDialog.Title>
  );
}

function Description({ children }: { children: ReactNode | string }) {
  return (
    <Box flexShrink="0">
      <RadixDialog.Description size="2" mb="0">
        <Text color="text-mid" size="large">
          {children}
        </Text>
      </RadixDialog.Description>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Body — the scrollable content area.
//
// Auto-renders an ErrorDisplay when setError has been called on the context,
// so DialogForm consumers get error handling for free.
// ---------------------------------------------------------------------------

function Body({ children }: { children: ReactNode }) {
  const { bodyRef, error } = useDialogContext();
  return (
    <Box
      ref={bodyRef}
      mt="4"
      mb="3"
      mx="-7"
      px="7"
      flexGrow="1"
      overflowY="auto"
      overflowX="hidden"
    >
      {error && <ErrorDisplay error={error} mb="5" />}
      {children}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Footer — fixed area at the bottom of the dialog, preceded by a separator.
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
      <Inset side="x">
        <Separator size="4" my="5" />
      </Inset>
      <Flex gap="3" justify={justify}>
        {children}
      </Flex>
    </Box>
  );
}

// Re-export the Radix Close so consumers can do
// <Dialog.Close asChild><Button .../></Dialog.Close>, or bind to their own
// close handler.
const Close = RadixDialog.Close;

// ---------------------------------------------------------------------------
// Namespace export.
//
// Consumers use <Dialog.Root>, <Dialog.Header>, <Dialog.Title>, etc. — see
// components/Dialog/FormDialog for a reference composition, and the Base UI /
// Radix Themes Dialog docs for the design intent. Form semantics live in
// components/Dialog/DialogForm; import <DialogForm> from there directly.
// ---------------------------------------------------------------------------

const Dialog = {
  Root,
  Header,
  Title,
  Description,
  Body,
  Footer,
  Close,
};

export default Dialog;
