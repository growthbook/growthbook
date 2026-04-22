import { createContext, ReactNode, useContext, useMemo, useState } from "react";
import { truncateString } from "shared/util";
import { useDialogContext } from "@/ui/Dialog";

// ---------------------------------------------------------------------------
// DialogForm — optional wrapper that turns a Dialog body into a submittable
// form.
//
// Owns loading state, error-on-submit handling, and submit-success/error
// tracking. Exposes loading via <useDialogForm()> so a submit button can show
// a spinner without explicit plumbing. Must be rendered inside a <Dialog.Root>
// because it reads setError / scrollBodyToTop / sendTrackingEvent from the
// Dialog context.
// ---------------------------------------------------------------------------

type DialogFormContextValue = {
  loading: boolean;
};

const DialogFormContext = createContext<DialogFormContextValue>({
  loading: false,
});

// Lets a descendant (typically the submit button) read the pending state of
// the enclosing <DialogForm>. Returns { loading: false } when there is no
// DialogForm ancestor, so it is always safe to call.
export function useDialogForm(): DialogFormContextValue {
  return useContext(DialogFormContext);
}

type DialogFormProps = {
  onSubmit: () => void | Promise<void>;
  trackOnSubmit?: boolean;
  children: ReactNode;
};

export default function DialogForm({
  onSubmit,
  trackOnSubmit = true,
  children,
}: DialogFormProps) {
  const { setError, scrollBodyToTop, sendTrackingEvent } = useDialogContext();
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

  const formCtx = useMemo<DialogFormContextValue>(
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
      <DialogFormContext.Provider value={formCtx}>
        {children}
      </DialogFormContext.Provider>
    </form>
  );
}
