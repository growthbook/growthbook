import { createContext, ReactNode, useContext, useMemo, useState } from "react";
import { truncateString } from "shared/util";
import { useModalContext } from "@/ui/Modal";

// ---------------------------------------------------------------------------
// ModalForm — optional wrapper that turns a Modal body into a submittable
// form.
//
// Owns loading state, error-on-submit handling, and submit-success/error
// tracking. Exposes loading via <useModalForm()> so a submit button can show
// a spinner without explicit plumbing. Must be rendered inside a <Modal.Root>
// because it reads setError / scrollBodyToTop / sendTrackingEvent from the
// Modal context.
// ---------------------------------------------------------------------------

type ModalFormContextValue = {
  loading: boolean;
};

const ModalFormContext = createContext<ModalFormContextValue>({
  loading: false,
});

// Lets a descendant (typically the submit button) read the pending state of
// the enclosing <ModalForm>. Returns { loading: false } when there is no
// ModalForm ancestor, so it is always safe to call.
export function useModalForm(): ModalFormContextValue {
  return useContext(ModalFormContext);
}

type ModalFormProps = {
  onSubmit: () => void | Promise<void>;
  trackOnSubmit?: boolean;
  children: ReactNode;
};

export default function ModalForm({
  onSubmit,
  trackOnSubmit = true,
  children,
}: ModalFormProps) {
  const { setError, scrollBodyToTop, sendTrackingEvent } = useModalContext();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      await onSubmit();
      setLoading(false);
      if (trackOnSubmit) {
        sendTrackingEvent("modal-submit-success");
      }
    } catch (err) {
      setError(err.message);
      scrollBodyToTop();
      setLoading(false);
      if (trackOnSubmit) {
        sendTrackingEvent("modal-submit-error", {
          error: truncateString(err.message, 32),
        });
      }
    }
  };

  const formCtx = useMemo<ModalFormContextValue>(
    () => ({ loading }),
    [loading],
  );

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <ModalFormContext.Provider value={formCtx}>
        {children}
      </ModalFormContext.Provider>
    </form>
  );
}
