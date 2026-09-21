import { ReactNode, ComponentProps } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import VisuallyHidden from "@/ui/VisuallyHidden";
import Modal, { Padding, Size, TrackingEventModalProps } from "@/ui/Modal";
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
  // Keeps the title as the dialog's accessible name while dropping the visible
  // heading row. Takes `headerAction` with it.
  hideHeader?: boolean;
  /** Space between the body and the footer's separator. */
  bodyMb?: "0" | "3";
  headerAction?: ReactNode;
  subheader?: ReactNode;
  cta?: string;
  ctaColor?: "red" | "violet";
  ctaEnabled?: boolean;
  size?: Size;
  /** "even" pads the content box on all sides. See Modal.Root. */
  padding?: Padding;
  /** Suppress Radix's open-autofocus when the modal places focus itself. */
  onOpenAutoFocus?: ComponentProps<typeof Modal.Root>["onOpenAutoFocus"];
  submit?: () => void | Promise<void>;
  trackOnSubmit?: boolean;
  dismissible?: boolean;
  /** Adds Radix's corner close alongside the footer's Cancel. */
  showCloseButton?: boolean;
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
  hideHeader = false,
  bodyMb,
  headerAction,
  subheader,
  cta = "Save",
  ctaColor = "violet",
  ctaEnabled = true,
  onOpenAutoFocus,
  size = "md",
  padding,
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
  showCloseButton,
}: Props) {
  const content = (
    <>
      {hideHeader ? (
        <VisuallyHidden>
          <Modal.Title>{header}</Modal.Title>
        </VisuallyHidden>
      ) : (
        <Modal.Header>
          <Modal.Title>{header}</Modal.Title>
          {headerAction ? <Box>{headerAction}</Box> : null}
        </Modal.Header>
      )}
      {subheader && <Modal.Description>{subheader}</Modal.Description>}
      <Modal.Body mt={hideHeader ? "0" : "5"} mb={bodyMb}>
        {children}
      </Modal.Body>
      <Modal.Footer
        justify={secondaryAction ? "between" : "end"}
        // Only with a secondary slot: buttons alone look the same either way.
        align={secondaryAction ? "center" : undefined}
      >
        {secondaryAction ? (
          // The footer pulls left to meet the separator; bring this back to
          // the body's left edge so it reads as a caption, not an overhang.
          <Box ml={padding === "even" ? "0" : "3"}>{secondaryAction}</Box>
        ) : null}
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
      padding={padding}
      dismissible={dismissible ?? !submit}
      showCloseButton={showCloseButton}
      hasDescription={!!subheader}
      onOpenAutoFocus={onOpenAutoFocus}
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
