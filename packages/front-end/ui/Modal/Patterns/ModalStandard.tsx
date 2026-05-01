import { ReactNode } from "react";
import { Box } from "@radix-ui/themes";
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
  close: () => void;
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
  close,
  children,
  trackingEventModalType,
  trackingEventModalSource,
  allowlistedTrackingEventProps = {},
  trackOnSubmit = true,
}: Props) {
  const content = (
    <>
      <Modal.Header>
        <Modal.Title>{header}</Modal.Title>
        {headerAction ? <Box>{headerAction}</Box> : null}
      </Modal.Header>
      {subheader && <Modal.Description>{subheader}</Modal.Description>}
      <Modal.Body>{children}</Modal.Body>
      <Modal.Footer>
        <Modal.Close>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
        </Modal.Close>
        {submit && (
          <SubmitButton cta={cta} ctaColor={ctaColor} ctaEnabled={ctaEnabled} />
        )}
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
