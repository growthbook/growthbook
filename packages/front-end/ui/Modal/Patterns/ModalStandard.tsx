import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import Modal, { Size, TrackingEventModalProps } from "@/ui/Modal";
import ModalForm, { useModalForm } from "../ModalForm";

function SubmitButton({
  cta,
  ctaColor,
  ctaEnabled,
}: {
  cta: string;
  ctaColor: "red" | "violet";
  ctaEnabled: boolean;
}) {
  const { loading } = useModalForm();
  return (
    <Button
      type="submit"
      disabled={!ctaEnabled}
      color={ctaColor}
      loading={loading}
    >
      {cta}
    </Button>
  );
}

export type Props = TrackingEventModalProps & {
  open: boolean;
  header: string;
  headerAction?: ReactNode;
  subheader?: ReactNode;
  cta?: string;
  ctaColor?: "red" | "violet";
  ctaEnabled?: boolean;
  size?: Size;
  submit?: () => void | Promise<void>;
  trackOnSubmit?: boolean;
  dismissible?: boolean;
  // Optional button rendered on the left side of the footer. Use for
  // destructive or out-of-flow actions that shouldn't be the primary CTA.
  secondaryAction?: ReactNode;
  close: () => void;
  closeCta?: string;
  children: ReactNode;
};

// ModalStandard is the opinionated wrapper around the composable Modal
// primitives: header + scrollable body + Cancel / Save footer, optionally
// wired to a form submit. New modals with one-off layouts should compose
// <Modal.Root> primitives directly instead of reaching for more props here.
export default function ModalStandard({
  open,
  header,
  headerAction,
  subheader,
  cta = "Save",
  ctaColor = "violet",
  ctaEnabled = true,
  size = "md",
  submit,
  secondaryAction,
  close,
  closeCta = "Cancel",
  children,
  trackingEventModalType,
  trackingEventModalSource,
  allowlistedTrackingEventProps = {},
  trackOnSubmit = true,
  dismissible,
}: Props) {
  const content = (
    <>
      <Modal.Header>
        <Modal.Title>{header}</Modal.Title>
        {headerAction ? <Box>{headerAction}</Box> : null}
      </Modal.Header>
      {subheader && <Modal.Description>{subheader}</Modal.Description>}
      <Modal.Body>{children}</Modal.Body>
      <Modal.Footer justify={secondaryAction ? "between" : "end"}>
        {secondaryAction ? <Box>{secondaryAction}</Box> : null}
        <Flex gap="3" align="center">
          <Modal.Close>
            <Button variant="ghost" onClick={close}>
              {closeCta}
            </Button>
          </Modal.Close>
          {submit && (
            <SubmitButton
              cta={cta}
              ctaColor={ctaColor}
              ctaEnabled={ctaEnabled}
            />
          )}
        </Flex>
      </Modal.Footer>
    </>
  );

  return (
    <Modal.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      size={size}
      dismissible={dismissible ?? !submit}
      hasDescription={!!subheader}
      trackingEventModalType={trackingEventModalType}
      trackingEventModalSource={trackingEventModalSource}
      allowlistedTrackingEventProps={allowlistedTrackingEventProps}
    >
      {submit ? (
        <ModalForm
          onSubmit={async () => {
            await submit();
            close();
          }}
          trackOnSubmit={trackOnSubmit}
        >
          {content}
        </ModalForm>
      ) : (
        content
      )}
    </Modal.Root>
  );
}
