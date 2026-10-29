import { ComponentProps, CSSProperties, ReactNode } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiX } from "react-icons/pi";
import Button from "@/ui/Button";
import Modal, {
  Size,
  TrackingEventModalProps,
  useModalContext,
} from "@/ui/Modal";
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

// Disabled while submitting, since closing wouldn't stop the in-flight submit.
function CloseButton({
  closeCta,
  close,
}: {
  closeCta: string;
  close: () => void;
}) {
  const { loading } = useModalForm();
  return (
    <Modal.Close>
      <Button variant="ghost" onClick={close} disabled={loading}>
        {closeCta}
      </Button>
    </Modal.Close>
  );
}

function HeaderCloseButton() {
  const { loading } = useModalContext();
  return (
    <Modal.Close>
      <IconButton
        type="button"
        variant="ghost"
        color="gray"
        aria-label="Close"
        disabled={loading}
      >
        <PiX size={16} />
      </IconButton>
    </Modal.Close>
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
  compact?: boolean;
  /** Replaces the default of focusing the first field. */
  onOpenAutoFocus?: ComponentProps<typeof Modal.Root>["onOpenAutoFocus"];
  submit?: () => void | Promise<void>;
  trackOnSubmit?: boolean;
  dismissible?: boolean;
  // Optional button rendered on the left side of the footer. Use for
  // destructive or out-of-flow actions that shouldn't be the primary CTA.
  secondaryAction?: ReactNode;
  // Full-bleed strip between the body and the footer, e.g. a ModalWarningBanner.
  aboveFooterContent?: ReactNode;
  close: () => void;
  closeCta?: string;
  children: ReactNode;
};

// Radix focuses the first tabbable node, which pops an icon button's tooltip.
// Prefer the first field to type into, else the dialog itself.
const focusFirstField: NonNullable<
  ComponentProps<typeof Modal.Root>["onOpenAutoFocus"]
> = (e) => {
  const content = e.currentTarget as HTMLElement;
  e.preventDefault();
  const fields = content.querySelectorAll<HTMLElement>(
    "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([disabled]), textarea:not([disabled]), [contenteditable='true']",
  );
  for (const field of Array.from(fields)) {
    // Skips what keyboard focus skips, such as a dropzone's hidden input.
    if (
      field.getAttribute("tabindex")?.trim().startsWith("-") ||
      !field.getClientRects().length
    ) {
      continue;
    }
    field.focus({ preventScroll: true });
    if (document.activeElement === field) return;
  }
  content.focus({ preventScroll: true });
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
  onOpenAutoFocus,
  size = "md",
  compact,
  submit,
  secondaryAction,
  aboveFooterContent,
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
        {compact && <HeaderCloseButton />}
      </Modal.Header>
      {subheader && <Modal.Description>{subheader}</Modal.Description>}
      <Modal.Body>{children}</Modal.Body>
      {aboveFooterContent ? (
        <Box
          style={
            {
              "--modal-warning-banner-inset": "var(--space-7)",
            } as CSSProperties
          }
        >
          {aboveFooterContent}
        </Box>
      ) : null}
      <Modal.Footer
        justify={secondaryAction ? "between" : "end"}
        align={secondaryAction ? "center" : undefined}
      >
        {secondaryAction ? (
          // Offsets the footer's leftward pull so this lines up with the body.
          <Box ml="3">{secondaryAction}</Box>
        ) : null}
        <Flex gap="3" align="center">
          <CloseButton closeCta={closeCta} close={close} />
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
      compact={compact}
      dismissible={dismissible ?? !submit}
      hasDescription={!!subheader}
      onOpenAutoFocus={onOpenAutoFocus ?? focusFirstField}
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
