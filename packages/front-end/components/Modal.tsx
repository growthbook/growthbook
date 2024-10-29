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
import { v4 as uuidv4 } from "uuid";
import track, { TrackEventProps } from "@/services/track";
import ConditionalWrapper from "@/components/ConditionalWrapper";
import LoadingOverlay from "./LoadingOverlay";
import Portal from "./Modal/Portal";
import Tooltip from "./Tooltip/Tooltip";
import { DocLink, DocSection } from "./DocLink";

type ModalProps = {
  header?: "logo" | string | ReactNode | boolean;
  subHeader?: string | ReactNode;
  open: boolean;
  // An empty string will prevent firing a tracking event, but the prop is still required to encourage developers to add tracking
  trackingEventModalType: string;
  // The source (likely page or component) causing the modal to be shown
  trackingEventModalSource?: string;
  // Currently the allowlist for what event props are valid is controlled outside of the codebase.
  // Make sure you've checked that any props you pass here are in the list!
  allowlistedTrackingEventProps?: TrackEventProps;
  modalUuid?: string;
  trackOnSubmit?: boolean;
  className?: string;
  submitColor?: string;
  cta?: string | ReactNode;
  ctaEnabled?: boolean;
  closeCta?: string | ReactNode;
  includeCloseCta?: boolean;
  onClickCloseCta?: () => Promise<void> | void;
  closeCtaClassName?: string;
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
  backCTA?: ReactNode;
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
  subHeader = "",
  children,
  close,
  submit,
  fullWidthSubmit = false,
  submitColor = "primary",
  open = true,
  cta = "Submit",
  ctaEnabled = true,
  closeCta = "Cancel",
  onClickCloseCta,
  closeCtaClassName = "btn btn-link",
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
  backCTA,
  successMessage,
  bodyClassName = "",
  formRef,
  customValidation,
  increasedElevation,
  stickyFooter = false,
  trackingEventModalType,
  trackingEventModalSource,
  allowlistedTrackingEventProps = {},
  modalUuid: _modalUuid,
  trackOnSubmit = true,
}) => {
  const [modalUuid] = useState(_modalUuid || uuidv4());
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
          <div>
            <h4 className="modal-title">
              {header === "logo" ? (
                <img
                  alt="GrowthBook"
                  src="/logo/growthbook-logo.png"
                  style={{ height: 40 }}
                />
              ) : (
                header
              )}
              {docSection && (
                <DocLink docSection={docSection}>
                  <Tooltip body="View Documentation" className="ml-1 w-4 h-4" />
                </DocLink>
              )}
            </h4>
            {subHeader ? <div className="mt-1">{subHeader}</div> : null}
          </div>
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
      {submit ||
      secondaryCTA ||
      tertiaryCTA ||
      backCTA ||
      (close && includeCloseCta) ? (
        <div
          className={clsx("modal-footer", { "sticky-footer": stickyFooter })}
        >
          {backCTA ? (
            <>
              {backCTA}
              <div className="flex-1" />
            </>
          ) : null}
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
          <ConditionalWrapper
            condition={stickyFooter}
            wrapper={
              <div
                className="container pagecontents mx-auto text-right"
                style={{ maxWidth: 1100 }}
              />
            }
          >
            {close && includeCloseCta ? (
              <button
                type="button"
                className={closeCtaClassName}
                onClick={async (e) => {
                  e.preventDefault();
                  await onClickCloseCta?.();
                  close();
                }}
              >
                {isSuccess && successMessage ? "Close" : closeCta}
              </button>
            ) : null}
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
            ) : null}
            {tertiaryCTA}
          </ConditionalWrapper>
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
        eventGroupUuid: modalUuid,
        ...allowlistedTrackingEventProps,
        ...(additionalProps || {}),
      });
    },
    [
      trackingEventModalType,
      trackingEventModalSource,
      allowlistedTrackingEventProps,
      modalUuid,
    ]
  );

  useEffect(() => {
    if (open) {
      sendTrackingEvent("modal-open");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
                if (trackOnSubmit) {
                  sendTrackingEvent("modal-submit-success");
                }
              } catch (e) {
                setError(e.message);
                setLoading(false);
                if (trackOnSubmit) {
                  sendTrackingEvent("modal-submit-error", {
                    error: truncateString(e.message, 32),
                  });
                }
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
