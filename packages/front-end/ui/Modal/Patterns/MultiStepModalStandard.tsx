import { cloneElement, ReactNode } from "react";
import { Box } from "@radix-ui/themes";
import Modal, { Size, TrackingEventModalProps } from "@/ui/Modal";
import MultiStepModal, {
  flattenChildren,
  isDoneElement,
  isStepElement,
} from "../MultiStepModal";

export type Props = TrackingEventModalProps & {
  open: boolean;
  close: () => void;
  header: string;
  // Optional element on the right of the header, e.g. a docs link.
  headerAction?: ReactNode;
  size?: Size;
  // Label for the button on the last step. Earlier steps show "Next".
  cta?: string;
  submit: () => void | Promise<void>;
  initialStep?: number;
  // <MultiStepModal.Step> elements, plus an optional <MultiStepModal.Done>.
  children: ReactNode;
};

// MultiStepModalStandard is the opinionated composition of the MultiStepModal
// primitives for the common wizard: header, Stepper, one scrollable body per
// step, and the standard Back / Cancel / Next footer. Step content is wrapped
// in Modal.Body for you.
//
// Wizards with non-standard layouts (a full-bleed editor, content above the
// footer, custom footer actions, per-step headers) should compose the
// MultiStepModal primitives directly instead of adding props here.
export default function MultiStepModalStandard({
  open,
  close,
  header,
  headerAction,
  size = "md",
  cta = "Save",
  submit,
  initialStep,
  trackingEventModalType,
  trackingEventModalSource,
  allowlistedTrackingEventProps,
  children,
}: Props) {
  const content = flattenChildren(children).map((node) =>
    isStepElement(node) || isDoneElement(node)
      ? cloneElement(
          node,
          undefined,
          <Modal.Body>{node.props.children}</Modal.Body>,
        )
      : node,
  );

  return (
    <MultiStepModal.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      size={size}
      initialStep={initialStep}
      onSubmit={submit}
      trackingEventModalType={trackingEventModalType}
      trackingEventModalSource={trackingEventModalSource}
      allowlistedTrackingEventProps={allowlistedTrackingEventProps}
    >
      <Modal.Header>
        <Modal.Title>{header}</Modal.Title>
        {headerAction ? <Box>{headerAction}</Box> : null}
      </Modal.Header>
      <MultiStepModal.Stepper />
      {content}
      <MultiStepModal.Footer submitLabel={cta} />
    </MultiStepModal.Root>
  );
}
