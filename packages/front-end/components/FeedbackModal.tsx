import React, { ReactElement, ReactNode } from "react";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import track from "@/services/track";

interface Props {
  open: boolean;
  close: () => void;
  submitCallback?: () => void | Promise<void>;
  header: string | ReactElement;
  cta?: string | ReactElement;
  sentCta?: string | ReactElement;
  prompt?: string | ReactElement;
  followUpEmail?: boolean;
  children?: ReactNode;
  source?: string;
}

export default function FeedbackModal({
  open,
  close,
  submitCallback,
  header,
  cta,
  sentCta,
  prompt,
  followUpEmail = true,
  children = null,
  source = "feedback",
}: Props) {
  const formRef = React.useRef<HTMLFormElement>(null);
  const [formState, setFormState] = React.useState<"initial" | "submitted">(
    "initial"
  );
  const ctaEnabled = formState === "initial";

  return (
    <Modal
      open={open}
      header={header}
      cta={ctaEnabled ? cta : sentCta ?? cta}
      closeCta="Close"
      close={close}
      submit={() => {
        if (!formRef.current) return;
        const formData = new FormData(formRef.current);
        const data = Object.fromEntries(formData.entries());
        track("feedback", { source, ...data });
        setFormState("submitted");
        submitCallback?.();
      }}
      formRef={formRef}
      autoCloseOnSubmit={false}
      ctaEnabled={ctaEnabled}
    >
      {formState === "initial" ? (
        <>
          {prompt ? (
            <Field
              label={prompt}
              required
              textarea
              minRows={3}
              name="feedback"
            />
          ) : null}
          {followUpEmail ? (
            <Field label="Email (optional)" name="email" type="email" />
          ) : null}
          {children}
        </>
      ) : (
        <div className="text-center">
          <p>Thank you for your feedback!</p>
        </div>
      )}
    </Modal>
  );
}
