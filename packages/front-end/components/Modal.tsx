import {
  FC,
  useRef,
  useEffect,
  useState,
  ReactNode,
  CSSProperties,
  useCallback,
} from "react";
import clsx from "clsx";
import { truncateString } from "shared/util";
import track, { TrackEventProps } from "@/services/track";
import LoadingOverlay from "./LoadingOverlay";
import Portal from "./Modal/Portal";
import Tooltip from "./Tooltip/Tooltip";
import { DocLink, DocSection } from "./DocLink";

type ModalProps = {
  header?: "logo" | string | ReactNode | boolean;
  open: boolean;
  // An empty string will prevent firing a tracking event, but the prop is still required to encourage developers to add tracking
  trackingEventModalType: string;
  // The source (likely page or component) causing the modal to be shown
  trackingEventModalSource?: string;
  // Currently the allowlist for what event props are valid is controlled outside of the codebase.
  // Make sure you've checked that any props you pass here are in the list!
  allowlistedTrackingEventProps?: TrackEventProps;
  className?: string;
  submitColor?: string;
  cta?: string | ReactNode;
  closeCta?: string | ReactNode;
  includeCloseCta?: boolean;
  ctaEnabled?: boolean;
  disabledMessage?: string;
  docSection?: DocSection;
  error?: string;
  loading?: boolean;
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
  secondaryCTA?: ReactNode;
  tertiaryCTA?: ReactNode;
  successMessage?: string;
  children: ReactNode;
  bodyClassName?: string;
  formRef?: React.RefObject<HTMLFormElement>;
  customValidation?: () => Promise<boolean> | boolean;
  increasedElevation?: boolean;
  stickyFooter?: boolean;
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
  loading: externalLoading,
  secondaryCTA,
  tertiaryCTA,
  successMessage,
  bodyClassName = "",
  formRef,
  customValidation,
  increasedElevation,
  stickyFooter = false,
  trackingEventModalType,
  trackingEventModalSource,
  allowlistedTrackingEventProps = {},
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

  useEffect(() => {
    setLoading(externalLoading || false);
  }, [externalLoading]);

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
          overflowAuto
            ? {
                overflowY: "auto",
                scrollBehavior: "smooth",
                marginBottom: stickyFooter ? "100px" : undefined,
              }
            : {}
        }
      >
        {isSuccess ? (
          <div className="alert alert-success">{successMessage}</div>
        ) : (
          children
        )}
      </div>
      {submit || secondaryCTA || (close && includeCloseCta) ? (
        <div
          className="modal-footer"
          style={
            stickyFooter
              ? {
                  position: "fixed",
                  left: "0",
                  bottom: "0",
                  width: "100%",
                  backgroundColor: "var(--surface-background-color-alt)",
                }
              : undefined
          }
        >
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
          <div
            className={
              stickyFooter ? "container pagecontents mx-auto text-right" : ""
            }
            style={stickyFooter ? { maxWidth: "1100px" } : undefined}
          >
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
                  } ${stickyFooter ? "ml-auto mr-5" : ""}`}
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
        </div>
      ) : null}
    </div>
  );

  const overlayStyle: CSSProperties = solidOverlay
    ? {
        opacity: 1,
      }
    : {};

  if (increasedElevation) {
    overlayStyle.zIndex = 1500;
  }

  const sendTrackingEvent = useCallback(
    (eventName: string, additionalProps?: Record<string, unknown>) => {
      if (trackingEventModalType === "") {
        return;
      }
      track(eventName, {
        type: trackingEventModalType,
        source: trackingEventModalSource,
        ...allowlistedTrackingEventProps,
        ...(additionalProps || {}),
      });
    },
    [
      trackingEventModalType,
      trackingEventModalSource,
      allowlistedTrackingEventProps,
    ]
  );

  useEffect(() => {
    if (open) {
      sendTrackingEvent("modal-open");
    }
  }, [open, sendTrackingEvent]);

  const modalHtml = (
    <div
      className={clsx("modal", { show: open })}
      style={{
        display: open ? "block" : "none",
        position: inline ? "relative" : undefined,
        zIndex: inline ? 1 : increasedElevation ? 1550 : undefined,
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
              e.stopPropagation();
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
                sendTrackingEvent("modal-submit-success");
              } catch (e) {
                setError(e.message);
                setLoading(false);
                sendTrackingEvent("modal-submit-error", {
                  error: truncateString(e.message, 32),
                });
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
