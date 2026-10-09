import { ReactNode, useMemo } from "react";
import { truncateString } from "shared/util";
import { useModalContext, useOptionalModalContext } from "@/ui/Modal";
import { getErrorDetails } from "@/services/apiCallError";

// ---------------------------------------------------------------------------
// ModalForm — optional wrapper that turns a Modal body into a submittable
// form.
//
// Handles error-on-submit and submit-success/error tracking, and writes the
// pending state onto Modal.Root so dismiss and the submit button share it.
// Exposes that state via <useModalForm()>. Must be rendered inside a
// <Modal.Root> because it reads setError / scrollBodyToTop /
// sendTrackingEvent from the Modal context.
// ---------------------------------------------------------------------------

type ModalFormContextValue = {
  loading: boolean;
};

// Lets a descendant (typically the submit button) read the pending state of
// the enclosing modal. Returns { loading: false } outside a Modal, so it is
// always safe to call. Loading lives on Modal.Root so dismiss can follow it.
export function useModalForm(): ModalFormContextValue {
  const ctx = useOptionalModalContext();
  const loading = ctx?.loading ?? false;
  return useMemo(() => ({ loading }), [loading]);
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
  const { setError, scrollBodyToTop, sendTrackingEvent, loading, setLoading } =
    useModalContext();

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
      setError(err.message, getErrorDetails(err));
      scrollBodyToTop();
      setLoading(false);
      if (trackOnSubmit) {
        sendTrackingEvent("modal-submit-error", {
          error: truncateString(err.message, 32),
        });
      }
    }
  };

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
      {children}
    </form>
  );
}
