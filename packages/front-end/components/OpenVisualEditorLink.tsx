import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { FaExternalLinkAlt } from "react-icons/fa";
import { getApiHost } from "@/services/env";
import track from "@/services/track";
import { appendQueryParamsToURL } from "@/services/utils";
import { useAuth } from "@/services/auth";
import Modal from "./Modal";
import LoadingSpinner from "./LoadingSpinner";

const CHROME_EXTENSION_LINK =
  "https://chrome.google.com/webstore/detail/growthbook-devtools/opemhndcehfgipokneipaafbglcecjia";

const isChromeExtInstalledLocally = async () => {
  try {
    const resp = await fetch(
      "chrome-extension://opemhndcehfgipokneipaafbglcecjia/js/logo192.png",
      {
        method: "HEAD",
      }
    );
    return resp.status === 200;
  } catch (e) {
    return false;
  }
};

type VisualEditorError = "no-extension" | "api-key-failed" | "not-chrome";

const ExtensionDialog: FC<{
  close: () => void;
  submit?: () => void;
  errorType: VisualEditorError;
  bypass: () => void;
}> = ({ close, submit, errorType, bypass }) => (
  <Modal
    open
    header="GrowthBook DevTools Extension"
    close={close}
    closeCta="Close"
    cta={errorType === "no-extension" ? "View extension" : "Close"}
    submit={submit}
  >
    {errorType === "no-extension" ? (
      <>
        You&apos;ll need to install the GrowthBook DevTools Chrome extension to
        use the visual editor.
      </>
    ) : errorType === "api-key-failed" ? (
      <>
        We were unable to fetch an API key to initialize the Visual Editor.
        Please try again or contact support.
      </>
    ) : errorType === "not-chrome" ? (
      <>
        The Visual Editor is currently only supported in Chrome. We are working
        on bringing the Visual Editor to other browsers.
      </>
    ) : (
      <>There was an error. Please try again or contact support.</>
    )}{" "}
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        bypass();
      }}
      target="_blank"
      rel="noreferrer"
    >
      Click here to proceed anyway
    </a>
    .
  </Modal>
);

const OpenVisualEditorLink: FC<{
  visualEditorUrl: string;
  id: string;
  openSettings?: () => void;
  changeIndex: number;
}> = ({ id, visualEditorUrl, openSettings, changeIndex }) => {
  const apiHost = getApiHost();
  const [errorType, setErrorType] = useState<VisualEditorError | null>(null);
  const [showEditorUrlDialog, setShowEditorUrlDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const isChromeBrowser = useMemo(() => {
    const ua = navigator.userAgent;
    return ua.indexOf("Chrome") > -1 && ua.indexOf("Edge") === -1;
  }, []);

  const { apiCall } = useAuth();

  const url = useMemo(() => {
    let url = visualEditorUrl.trim();

    // Force all URLs to be absolute
    if (!url.match(/^http(s)?:/)) {
      // We could use https here, but then it would break for people testing on localhost
      // Most sites redirect http to https, so this should work almost everywhere
      url = "http://" + url;
    }

    url = appendQueryParamsToURL(url, {
      "vc-id": id,
      "v-idx": changeIndex,
      "exp-url": encodeURIComponent(window.location.href),
      "api-host": encodeURIComponent(apiHost),
    });

    return url;
  }, [apiHost, changeIndex, id, visualEditorUrl]);

  const getVisualEditorKey = useCallback(async () => {
    const res = await apiCall<{ key: string }>("/visual-editor/key", {
      method: "GET",
    });
    return res.key;
  }, [apiCall]);

  const navigate = useCallback(
    async (options?: { bypass: boolean }) => {
      setIsLoading(true);

      try {
        const key = await getVisualEditorKey();
        window.postMessage(
          {
            type: "GB_REQUEST_OPEN_VISUAL_EDITOR",
            data: key,
          },
          window.location.origin
        );

        if (options?.bypass) {
          setIsLoading(false);
          track("Open visual editor", {
            source: "visual-editor-ui",
            status: "bypass",
          });
          window.location.href = url;
          return;
        }

        // for backwards compatibility, we force routing to the page if it doesn't
        // happen automatically after 1.5 seconds. this can be deleted once the
        // chrome extension is updated to support the postMessage auth token flow
        setTimeout(() => {
          setIsLoading(false);
          window.location.href = url;
        }, 1500);
      } catch (e) {
        setIsLoading(false);
        setErrorType("api-key-failed");
        return;
      }
    },
    [url, getVisualEditorKey]
  );

  // after postMessage is sent, listen for a response from the extension
  // to confirm that it was received and the extension is installed.
  // then navigate to the visual editor
  useEffect(() => {
    if (!url) return;

    const onMessage = (
      event: MessageEvent<{ type?: "GB_RESPONSE_OPEN_VISUAL_EDITOR" }>
    ) => {
      if (event.data.type === "GB_RESPONSE_OPEN_VISUAL_EDITOR") {
        track("Open visual editor", {
          source: "visual-editor-ui",
          status: "success",
        });
        setIsLoading(false);
        window.location.href = url;
      }
    };

    window.addEventListener("message", onMessage);

    return () => window.removeEventListener("message", onMessage);
  }, [url]);

  return (
    <>
      <span
        className="btn btn-sm btn-primary"
        style={{ width: "144px" }}
        onClick={async (e) => {
          e.preventDefault();

          if (!visualEditorUrl) {
            e.preventDefault();
            setShowEditorUrlDialog(true);
            track("Open visual editor", {
              source: "visual-editor-ui",
              status: "missing visualEditorUrl",
            });
            return false;
          }

          const isExtensionInstalled = await isChromeExtInstalledLocally();

          if (!isExtensionInstalled) {
            setErrorType(isChromeBrowser ? "no-extension" : "not-chrome");
            track("Open visual editor", {
              source: "visual-editor-ui",
              status: "missing extension",
            });
            return false;
          }

          navigate();
        }}
      >
        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <>
            Open Visual Editor <FaExternalLinkAlt />
          </>
        )}
      </span>

      {showEditorUrlDialog && openSettings && (
        <Modal
          open
          header="Visual Editor Target URL"
          close={() => setShowEditorUrlDialog(false)}
          closeCta="Close"
          cta="Open settings"
          submit={openSettings}
        >
          You&apos;ll need to define the{" "}
          <strong>Visual Editor Target URL</strong> in your experiment&apos;s
          settings first. This will configure which web page will be opened when
          you click on the &quot;Open the Editor&quot; button.
        </Modal>
      )}

      {errorType && (
        <ExtensionDialog
          errorType={errorType}
          close={() => setErrorType(null)}
          submit={
            errorType === "no-extension"
              ? () => {
                  window.open(CHROME_EXTENSION_LINK);
                }
              : undefined
          }
          bypass={() => navigate({ bypass: true })}
        ></ExtensionDialog>
      )}
    </>
  );
};

export default OpenVisualEditorLink;
