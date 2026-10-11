import { ReactNode } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiXBold } from "react-icons/pi";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Modal, {
  Size,
  TrackingEventModalProps,
  useModalContext,
} from "@/ui/Modal";
import ModalForm, { useModalForm } from "../ModalForm";
import styles from "./ModalStandard.module.scss";

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
  redesigned = false,
}: {
  closeCta: string;
  close: () => void;
  redesigned?: boolean;
}) {
  const { loading } = useModalForm();
  return (
    <Modal.Close>
      <Button
        variant="ghost"
        // redesigned: closing is Modal.Close's alone, through Root, so the
        // modal's fade-out plays before the host unmounts it.
        onClick={redesigned ? undefined : close}
        // redesigned: Modal.Close closes through this click, which
        // @/ui/Button's default preventDefault would cancel. Otherwise the
        // onClick closes, as before, and Modal.Close stays out of it.
        preventDefault={!redesigned}
        disabled={loading}
        // redesigned: as the Create Experiment modal's Cancel (set in
        // review): grey, --slate-12 text at 400 (.ghostButton), and 6px
        // corners on its hover fill.
        {...(redesigned
          ? {
              color: "gray" as const,
              className: styles.ghostButton,
              style: {
                borderRadius: "var(--radius-3)",
                color: "var(--slate-12)",
              },
            }
          : {})}
      >
        {closeCta}
      </Button>
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
  submit?: () => void | Promise<void>;
  trackOnSubmit?: boolean;
  dismissible?: boolean;
  // Optional button rendered on the left side of the footer. Use for
  // destructive or out-of-flow actions that shouldn't be the primary CTA.
  secondaryAction?: ReactNode;
  close: () => void;
  closeCta?: string;
  // The redesigned experiment pages' modal chrome (set in review), as the
  // Create Experiment modal's: a divider under the header, the title as a
  // page heading (16px at 600, trimmed, 28px above and below), a close
  // button at the header's right, lighter dividers, a body that scrolls
  // right up to both dividers, a grey Cancel, 32px at the sides, and a
  // soft fade-in. Optional and additive.
  redesigned?: boolean;
  children: ReactNode;
};

// The form, closing through Root once it's submitted, so a redesigned
// (fadeIn) modal fades out first; otherwise straight away, as before.
function SubmitForm({
  submit,
  close,
  redesigned,
  trackOnSubmit,
  children,
}: {
  submit: () => void | Promise<void>;
  close: () => void;
  redesigned: boolean;
  trackOnSubmit: boolean;
  children: ReactNode;
}) {
  const { requestClose } = useModalContext();
  return (
    <ModalForm
      onSubmit={async () => {
        await submit();
        if (redesigned) {
          requestClose();
        } else {
          close();
        }
      }}
      trackOnSubmit={trackOnSubmit}
    >
      {children}
    </ModalForm>
  );
}

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
  redesigned = false,
}: Props) {
  const content = (
    <>
      <Modal.Header divider={redesigned}>
        <Modal.Title pageHeading={redesigned}>{header}</Modal.Title>
        {redesigned ? (
          // The header's right side: its action, then a close button, with
          // no height of their own so the trimmed title sets the header's
          // height (see Modal.Header's divider). FALLBACK: Radix
          // IconButton; @/ui/ has no icon button.
          <Flex
            align="center"
            gap="4"
            style={{ height: 0, marginLeft: "auto" }}
          >
            {headerAction}
            <Modal.Close>
              <IconButton
                type="button"
                variant="ghost"
                color="gray"
                size="1"
                aria-label="Close"
              >
                <PiXBold size={16} style={{ color: "var(--slate-10)" }} />
              </IconButton>
            </Modal.Close>
          </Flex>
        ) : headerAction ? (
          <Box>{headerAction}</Box>
        ) : null}
      </Modal.Header>
      {subheader && !redesigned ? (
        <Modal.Description>{subheader}</Modal.Description>
      ) : null}
      <Modal.Body scrollToEdges={redesigned}>
        {subheader && redesigned ? (
          // Redesigned: the subheader leads the body (set in review), as
          // its first line, in --slate-11, 16px above the content, rather
          // than squeezed between the header's divider and the body.
          <Box mb="4" style={{ color: "var(--slate-11)" }}>
            <Text as="div" size="md">
              {subheader}
            </Text>
          </Box>
        ) : null}
        {children}
      </Modal.Body>
      <Modal.Footer
        justify={secondaryAction ? "between" : "end"}
        flushTop={redesigned}
      >
        {secondaryAction ? <Box>{secondaryAction}</Box> : null}
        <Flex gap="3" align="center">
          <CloseButton
            closeCta={closeCta}
            close={close}
            redesigned={redesigned}
          />
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
      dividerColor={redesigned ? "var(--gray-a5)" : undefined}
      paddingX={redesigned ? "var(--space-6)" : undefined}
      fadeIn={redesigned}
      dismissible={dismissible ?? !submit}
      hasDescription={!!subheader && !redesigned}
      trackingEventModalType={trackingEventModalType}
      trackingEventModalSource={trackingEventModalSource}
      allowlistedTrackingEventProps={allowlistedTrackingEventProps}
    >
      {submit ? (
        <SubmitForm
          submit={submit}
          close={close}
          redesigned={redesigned}
          trackOnSubmit={trackOnSubmit}
        >
          {content}
        </SubmitForm>
      ) : (
        content
      )}
    </Modal.Root>
  );
}
