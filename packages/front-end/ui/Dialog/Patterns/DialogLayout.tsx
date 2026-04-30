import { ReactNode } from "react";
import { Box } from "@radix-ui/themes";
import Button from "@/ui/Button";
import Dialog, { Size, TrackingEventModalProps } from "@/ui/Dialog";
import DialogForm, { useDialogForm } from "../DialogForm";

function SubmitButton({
  cta,
  ctaColor,
  ctaEnabled,
}: {
  cta: string;
  ctaColor: "red" | "violet";
  ctaEnabled: boolean;
}) {
  const { loading } = useDialogForm();
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

// DialogLayout is the opinionated wrapper around the composable Dialog
// primitives: header + scrollable body + Cancel / Save footer, optionally
// wired to a form submit. New dialogs with one-off layouts should compose
// <Dialog.Root> primitives directly instead of reaching for more props here.
export default function DialogLayout({
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
      <Dialog.Header>
        <Dialog.Title>{header}</Dialog.Title>
        {headerAction ? <Box>{headerAction}</Box> : null}
      </Dialog.Header>
      {subheader && <Dialog.Description>{subheader}</Dialog.Description>}
      <Dialog.Body>{children}</Dialog.Body>
      <Dialog.Footer>
        <Dialog.Close>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
        </Dialog.Close>
        {submit && (
          <SubmitButton cta={cta} ctaColor={ctaColor} ctaEnabled={ctaEnabled} />
        )}
      </Dialog.Footer>
    </>
  );

  return (
    <Dialog.Root
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
        <DialogForm
          onSubmit={async () => {
            await submit();
            close();
          }}
          trackOnSubmit={trackOnSubmit}
        >
          {content}
        </DialogForm>
      ) : (
        content
      )}
    </Dialog.Root>
  );
}
