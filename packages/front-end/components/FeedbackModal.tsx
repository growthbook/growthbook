import { ReactElement, ReactNode, useRef, useState } from "react";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import track from "@/services/track";
import { useUser } from "@/services/UserContext";

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
  const formRef = useRef<HTMLFormElement>(null);
  const [formState, setFormState] = useState<"initial" | "submitted">(
    "initial",
  );
  const ctaEnabled = formState === "initial";
  const { email } = useUser();

  return (
    <Modal
      trackingEventModalType=""
      open={open}
      header={header}
      cta={ctaEnabled ? cta : (sentCta ?? cta)}
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
            <Field
              label="Email (optional)"
              helpText="We may reach out to you with follow up questions. (We promise not to spam you)"
              name="email"
              type="email"
              defaultValue={email}
            />
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
