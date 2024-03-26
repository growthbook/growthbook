import {
  FC,
  useRef,
  useEffect,
  useState,
  ReactElement,
  ReactNode,
} from "react";
import clsx from "clsx";
import LoadingOverlay from "./LoadingOverlay";
import Portal from "./Modal/Portal";
import Tooltip from "./Tooltip/Tooltip";
import { DocLink, DocSection } from "./DocLink";

type ModalProps = {
  header?: "logo" | string | ReactElement | boolean;
  open: boolean;
  className?: string;
  submitColor?: string;
  cta?: string | ReactElement;
  closeCta?: string | ReactElement;
  includeCloseCta?: boolean;
  ctaEnabled?: boolean;
  disabledMessage?: string;
  docSection?: DocSection;
  error?: string;
  size?: "md" | "lg" | "max" | "fill";
  sizeY?: "max" | "fill";
  inline?: boolean;
  overflowAuto?: boolean;
  autoFocusSelector?: string;
  autoCloseOnSubmit?: boolean;
  solidOverlay?: boolean;
  close?: () => void;
  submit?: () => void | Promise<void>;
  fullWidthSubmit?: boolean;
  secondaryCTA?: ReactElement;
  tertiaryCTA?: ReactElement;
  successMessage?: string;
  children: ReactNode;
  bodyClassName?: string;
  formRef?: React.RefObject<HTMLFormElement>;
  customValidation?: () => Promise<boolean> | boolean;
};
const Modal: FC<ModalProps> = ({
  header = "logo",
  children,
  close,
  submit,
  fullWidthSubmit = false,
  submitColor = "primary",
  open = true,
  cta = "Submit",
  ctaEnabled = true,
  closeCta = "Cancel",
  includeCloseCta = true,
  disabledMessage,
  inline = false,
  size = "md",
  sizeY,
  docSection,
  className = "",
  autoCloseOnSubmit = true,
  overflowAuto = true,
  autoFocusSelector = "input:not(:disabled),textarea:not(:disabled),select:not(:disabled)",
  solidOverlay = false,
  error: externalError,
  secondaryCTA,
  tertiaryCTA,
  successMessage,
  bodyClassName = "",
  formRef,
  customValidation,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  if (inline) {
    size = "fill";
  }

  useEffect(() => {
    setError(externalError || null);
  }, [externalError]);

  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setTimeout(() => {
      if (!autoFocusSelector) return;
      if (open && bodyRef.current) {
        const input = bodyRef.current.querySelector<
          HTMLInputElement | HTMLTextAreaElement
        >(autoFocusSelector);
        if (input) {
          input.focus();
          if (input.select) {
            input.select();
          }
        }
      }
    }, 70);
  }, [open, autoFocusSelector]);

  const contents = (
    <div
      className={`modal-content ${className}`}
      style={{
        height: sizeY === "max" ? "93vh" : "",
        maxHeight: sizeY ? "" : size === "fill" ? "" : "93vh",
      }}
    >
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
          {docSection && (
            <DocLink docSection={docSection}>
              <Tooltip body="View Documentation" className="ml-1 w-4 h-4" />
            </DocLink>
          )}
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
              <span aria-hidden="true">&times;</span>
            </button>
          )}
        </>
      )}
      <div
        className={`modal-body ${bodyClassName}`}
        ref={bodyRef}
        style={
          overflowAuto ? { overflowY: "auto", scrollBehavior: "smooth" } : {}
        }
      >
        {isSuccess ? (
          <div className="alert alert-success">{successMessage}</div>
        ) : (
          children
        )}
      </div>
      {submit || (close && includeCloseCta) ? (
        <div className="modal-footer">
          {error && (
            <div className="alert alert-danger mr-auto">
              {error
                .split("\n")
                .filter((v) => !!v.trim())
                .map((s, i) => (
                  <div key={i}>{s}</div>
                ))}
            </div>
          )}
          {secondaryCTA}
          {submit && !isSuccess ? (
            <Tooltip
              body={disabledMessage || ""}
              shouldDisplay={!ctaEnabled && !!disabledMessage}
              tipPosition="top"
              className={fullWidthSubmit ? "w-100" : ""}
            >
              <button
                className={`btn btn-${submitColor} ${
                  fullWidthSubmit ? "w-100" : ""
                }`}
                type="submit"
                disabled={!ctaEnabled}
              >
                {cta}
              </button>
            </Tooltip>
          ) : (
            ""
          )}
          {close && includeCloseCta ? (
            <button
              className="btn btn-link"
              onClick={(e) => {
                e.preventDefault();
                close();
              }}
            >
              {isSuccess && successMessage ? "Close" : closeCta}
            </button>
          ) : null}
          {tertiaryCTA}
        </div>
      ) : null}
    </div>
  );

  const overlayStyle = solidOverlay
    ? {
        opacity: 1,
      }
    : {};

  const modalHtml = (
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
            : size === "fill"
            ? { width: "100%", maxWidth: "100%" }
            : {}
        }
      >
        {submit && !isSuccess ? (
          <form
            ref={formRef}
            onSubmit={async (e) => {
              e.preventDefault();
              if (loading) return;
              setError(null);
              setLoading(true);
              if (customValidation) {
                const resp = await customValidation();
                if (resp === false) {
                  setLoading(false);
                  return;
                }
              }
              try {
                await submit();

                setLoading(false);
                if (successMessage) {
                  setIsSuccess(true);
                } else if (close && autoCloseOnSubmit) {
                  close();
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
  );

  if (inline) {
    return modalHtml;
  }

  return (
    <Portal>
      <div
        className={clsx("modal-backdrop fade", {
          show: open,
          "d-none": !open,
          "bg-dark": solidOverlay,
        })}
        style={overlayStyle}
      />
      {modalHtml}
    </Portal>
  );
};

export default Modal;
