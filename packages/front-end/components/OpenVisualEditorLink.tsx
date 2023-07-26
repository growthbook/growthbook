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

const ExtensionDialog: FC<{
  close: () => void;
  submit?: () => void;
  children: React.ReactNode;
}> = ({ close, submit, children }) => (
  <Modal
    open
    header="GrowthBook DevTools Extension"
    close={close}
    closeCta="Close"
    cta="View extension"
    submit={submit}
  >
    {children}
  </Modal>
);

const OpenVisualEditorLink: FC<{
  visualEditorUrl: string;
  id: string;
  openSettings?: () => void;
  changeIndex: number;
}> = ({ id, visualEditorUrl, openSettings, changeIndex }) => {
  const apiHost = getApiHost();
  const [showExtensionDialog, setShowExtensionDialog] = useState(false);
  const [extensionDialogText, setExtensionDialogText] = useState("");
  const [showEditorUrlDialog, setShowEditorUrlDialog] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isBypassing, setIsBypassing] = useState(false);

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

  const navigate = useCallback(async () => {
    setShowExtensionDialog(false);

    // in the case a user has clicked 'proceed anyway' when we do not detect the
    // chrome extension installation, we ignore waiting for the responsem msg
    // and navigate right away.
    if (isBypassing) {
      setIsNavigating(false);

      track("Open visual editor", {
        source: "visual-editor-ui",
        status: "bypass",
      });

      window.location.href = url;

      return;
    }

    setIsNavigating(true);

    let key: string;
    try {
      key = await getVisualEditorKey();
    } catch (e) {
      setIsNavigating(false);
      setExtensionDialogText(
        "We were unable to fetch an API key to initialize the Visual Editor. Please try again or contact support."
      );
      setShowExtensionDialog(true);
      return;
    }

    window.postMessage(
      {
        type: "GB_REQUEST_OPEN_VISUAL_EDITOR",
        data: key,
      },
      window.location.origin
    );

    // for backwards-compatibility - if the chrome extension is out-of-date
    // and does not yet support the postMessage auth token flow, we route to
    // the page automatically after a certain timeout.
    // TODO this can be deleted after 0.3.1 of chrome ext is released to
    // all users
    setTimeout(() => {
      setIsNavigating(false);
      window.location.href = url;
    }, 1500);
  }, [url, getVisualEditorKey, isBypassing]);

  // we wait until the visual editor gives us a response message to open a new
  // window. this ensures that the api key is set upon loading it.
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

        setIsNavigating(false);

        window.location.href = url;
      }
    };

    window.addEventListener("message", onMessage);

    return () => window.removeEventListener("message", onMessage);
  }, [url]);

  useEffect(() => {
    if (!isBypassing) return;
    navigate();
  }, [navigate, isBypassing]);

  return (
    <>
      <span
        className="btn btn-sm btn-primary"
        style={{ width: "144px" }}
        onClick={async (e) => {
          e.preventDefault();

          const isExtensionInstalled = await isChromeExtInstalledLocally();

          if (!isExtensionInstalled) {
            setExtensionDialogText(
              isChromeBrowser
                ? "You'll need to install the GrowthBook DevTools Chrome extension to use the visual editor."
                : "The Visual Editor is currently only supported in Chrome. We are working on bringing the Visual Editor to other browsers."
            );
            setShowExtensionDialog(true);
            track("Open visual editor", {
              source: "visual-editor-ui",
              status: "missing extension",
            });
            return false;
          }

          navigate();
        }}
      >
        {isNavigating ? (
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

      {showExtensionDialog && (
        <ExtensionDialog
          close={() => setShowExtensionDialog(false)}
          submit={
            isChromeBrowser
              ? () => {
                  window.open(CHROME_EXTENSION_LINK);
                }
              : undefined
          }
        >
          <>
            {extensionDialogText ??
              `There was an error. Please try again or contact support.`}{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setIsBypassing(true);
              }}
              target="_blank"
              rel="noreferrer"
            >
              Click here to proceed anyway
            </a>
            .
          </>
        </ExtensionDialog>
      )}
    </>
  );
};

export default OpenVisualEditorLink;
