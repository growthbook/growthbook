import { FC, useRef, useEffect, useState, ReactElement } from "react";
import LoadingOverlay from "./LoadingOverlay";
import clsx from "clsx";
import Portal from "./Modal/Portal";

type ModalProps = {
  header?: "logo" | string | ReactElement | boolean;
  open: boolean;
  className?: string;
  submitColor?: string;
  cta?: string;
  closeCta?: string;
  ctaEnabled?: boolean;
  error?: string;
  size?: "md" | "lg" | "max";
  inline?: boolean;
  autoCloseOnSubmit?: boolean;
  solidOverlay?: boolean;
  close?: () => void;
  submit?: () => Promise<void>;
};
const Modal: FC<ModalProps> = ({
  header = "logo",
  children,
  close,
  submit,
  submitColor = "primary",
  open = true,
  cta = "Submit",
  ctaEnabled = true,
  closeCta = "Cancel",
  size = "md",
  className = "",
  autoCloseOnSubmit = true,
  inline = false,
  solidOverlay = false,
  error: externalError,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(externalError);
  }, [externalError]);

  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && bodyRef.current) {
      const input = bodyRef.current.querySelector<
        HTMLInputElement | HTMLTextAreaElement
      >("input,textarea");
      if (input) {
        input.focus();
        input.select();
      }
    }
  }, [open]);

  const contents = (
    <div className={`modal-content ${className}`} style={{ maxHeight: "93vh" }}>
      {loading && <LoadingOverlay />}
      {header ? (
        <div className="modal-header">
          <h5 className="modal-title">
            {header === "logo" ? (
              <img
                alt="GrowthBook"
                src="/logo/growthbook-logo.png"
                style={{ height: 40 }}
              />
            ) : (
              header
            )}
          </h5>
          {close && (
            <button
              type="button"
              className="close"
              onClick={(e) => {
                e.preventDefault();
                close();
              }}
              aria-label="Close"
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
      ) : (
        <>
          {close && (
            <button
              type="button"
              className="close"
              onClick={(e) => {
                e.preventDefault();
                close();
              }}
              aria-label="Close"
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </>
      )}
      <div className="modal-body" ref={bodyRef} style={{ overflowY: "auto" }}>
        {children}
      </div>
      {submit || close ? (
        <div className="modal-footer">
          {error && <div className="alert alert-danger mr-auto">{error}</div>}
          {submit ? (
            <button
              className={`btn btn-${ctaEnabled ? submitColor : "secondary"}`}
              type="submit"
              disabled={!ctaEnabled}
            >
              {cta}
            </button>
          ) : (
            ""
          )}
          {close && (
            <button
              className="btn btn-link"
              onClick={(e) => {
                e.preventDefault();
                close();
              }}
            >
              {closeCta}
            </button>
          )}
        </div>
      ) : (
        ""
      )}
    </div>
  );

  const overlayStyle = solidOverlay
    ? {
        opacity: 1,
      }
    : null;

  return (
    <Portal>
      {!inline && (
        <div
          className={clsx("modal-backdrop fade", {
            show: open,
            "d-none": !open,
            "bg-dark": solidOverlay,
          })}
          style={overlayStyle}
        />
      )}
      <div
        className={clsx("modal", { show: open })}
        style={{
          display: open ? "block" : "none",
          position: inline ? "relative" : undefined,
          zIndex: inline ? 1 : undefined,
        }}
      >
        <div
          className={`modal-dialog modal-${size}`}
          style={
            size === "max"
              ? { width: "95vw", maxWidth: 1400, margin: "2vh auto" }
              : null
          }
        >
          {submit ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (loading) return;
                setError(null);
                setLoading(true);
                try {
                  await submit();
                  if (close && autoCloseOnSubmit) {
                    close();
                  } else {
                    setLoading(false);
                  }
                } catch (e) {
                  setError(e.message);
                  setLoading(false);
                }
              }}
            >
              {contents}
            </form>
          ) : (
            contents
          )}
        </div>
      </div>
    </Portal>
  );
};

export default Modal;
