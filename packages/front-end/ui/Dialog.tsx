import {
  Box,
  Flex,
  Inset,
  Dialog as RadixDialog,
  Separator,
  Text,
} from "@radix-ui/themes";
import { Responsive } from "@radix-ui/themes/dist/esm/props/prop-def.js";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { truncateString } from "shared/util";
import track, { TrackEventProps } from "@/services/track";
import Button from "./Button";
import ErrorDisplay from "./ErrorDisplay";

export type Props = {
  open: boolean;
  header: string;
  subheader?: string;
  cta?: string;
  ctaEnabled?: boolean;
  size?: Size;
  submit: () => void | Promise<void>;
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
  subheader,
  cta = "Confirm",
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

  return (
    <RadixDialog.Root open={open} onOpenChange={close}>
      <RadixDialog.Content
        size={getRadixSize(size)}
        maxWidth={getMaxWidth(size)}
      >
        <form onSubmit={handleSubmit}>
          <Box p="2">
            <RadixDialog.Title size="4">{header}</RadixDialog.Title>
            {subheader && (
              <RadixDialog.Description size="2" mb="4">
                <Text style={{ color: "var(--color-text-mid)" }}>
                  {subheader}
                </Text>
              </RadixDialog.Description>
            )}
            <Box mt="5">
              {error && <ErrorDisplay error={error} mb="3" />}
              {children}
            </Box>
          </Box>
          <Inset side="x">
            <Separator size="4" my="4" />
          </Inset>
          <Flex gap="3" justify="end">
            <RadixDialog.Close>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
            </RadixDialog.Close>
            <Button type="submit" disabled={!ctaEnabled}>
              {cta}
            </Button>
          </Flex>
        </form>
      </RadixDialog.Content>
    </RadixDialog.Root>
  );
}
