import {
  Box,
  Flex,
  Inset,
  Dialog as RadixDialog,
  Separator,
} from "@radix-ui/themes";
import { Responsive } from "@radix-ui/themes/dist/esm/props/prop-def.js";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { truncateString } from "shared/util";
import track, { TrackEventProps } from "@/services/track";
import Button, { Color } from "./Button";
import ErrorDisplay from "./ErrorDisplay";
import Text from "./Text";

export type Props = {
  open: boolean;
  header: string;
  headerAction?: ReactNode;
  subheader?: string | ReactNode;
  cta?: string;
  ctaColor?: Color;
  ctaEnabled?: boolean;
  size?: Size;
  submit?: () => void | Promise<void>;
  close: () => void;
  children: ReactNode;
  // An empty string will prevent firing a tracking event, but the prop is still required to encourage developers to add tracking
  trackingEventModalType: string;
  // The source (likely page or component) causing the modal to be shown
  trackingEventModalSource?: string;
  // Currently the allowlist for what event props are valid is controlled outside of the codebase.
  // Make sure you've checked that any props you pass here are in the list!
  allowlistedTrackingEventProps?: TrackEventProps;
  trackOnSubmit?: boolean;
};

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

export default function Dialog({
  open,
  header,
  headerAction,
  subheader,
  cta = "Save",
  ctaColor = "violet",
  ctaEnabled = true,
  size = "md",
  submit,
  close,
  children,
  trackingEventModalType,
  trackingEventModalSource,
  allowlistedTrackingEventProps = {},
  trackOnSubmit = true,
}: Props) {
  const [modalUuid] = useState(uuidv4());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const bodyRef = useRef<HTMLDivElement>(null);

  const scrollToTop = () => {
    setTimeout(() => {
      if (bodyRef.current) {
        bodyRef.current.scrollTo({ top: 0, behavior: "smooth" });
      }
    }, 50);
  };
  useEffect(() => {
    if (open) {
      sendTrackingEvent("modal-open");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    if (!submit) return;
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      await submit();

      setLoading(false);
      close();

      if (trackOnSubmit) {
        sendTrackingEvent("modal-submit-success");
      }
    } catch (e) {
      setError(e.message);
      scrollToTop();
      setLoading(false);
      if (trackOnSubmit) {
        sendTrackingEvent("modal-submit-error", {
          error: truncateString(e.message, 32),
        });
      }
    }
  };

  const handleClose = () => {
    setError(null);
    close();
  };

  const innerContent = (
    <>
      <Box py="2" flexShrink="0">
        <Flex justify="between" align="center" mb="1">
          <RadixDialog.Title size="5" mb="0">
            {header}
          </RadixDialog.Title>
          {headerAction && <Box>{headerAction}</Box>}
        </Flex>
        {subheader && (
          <RadixDialog.Description size="2" mb="0">
            <Text color="text-mid" size="large">
              {subheader}
            </Text>
          </RadixDialog.Description>
        )}
      </Box>
      <Box
        ref={bodyRef}
        mt="4"
        mb="3"
        mx="-7"
        pl="7"
        pr="5"
        flexGrow="1"
        overflowY="auto"
        overflowX="hidden"
        style={{ scrollbarGutter: "stable" }}
      >
        {error && <ErrorDisplay error={error} mb="5" />}
        {children}
      </Box>
      <Box flexShrink="0">
        <Inset side="x">
          <Separator size="4" my="5" />
        </Inset>
        <Flex gap="3" justify="end">
          <RadixDialog.Close>
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
          </RadixDialog.Close>
          {submit && (
            <Button
              type="submit"
              disabled={!ctaEnabled}
              color={ctaColor}
              loading={loading}
            >
              {cta}
            </Button>
          )}
        </Flex>
      </Box>
    </>
  );

  return (
    <RadixDialog.Root open={open} onOpenChange={handleClose}>
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
          } as React.CSSProperties
        }
      >
        <Flex
          direction="column"
          flexGrow="1"
          minHeight="0"
          minWidth="0"
          {...(submit ? { asChild: true } : {})}
        >
          {submit ? (
            <form onSubmit={handleSubmit}>{innerContent}</form>
          ) : (
            innerContent
          )}
        </Flex>
      </RadixDialog.Content>
    </RadixDialog.Root>
  );
}
