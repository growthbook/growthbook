import { FC, MouseEvent, useCallback, useMemo, useState } from "react";
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

const OpenVisualEditorLink: FC<{
  visualEditorUrl: string;
  id: string;
  openSettings?: () => void;
  changeIndex: number;
}> = ({ id, visualEditorUrl, openSettings, changeIndex }) => {
  const apiHost = getApiHost();
  const [showExtensionDialog, setShowExtensionDialog] = useState(false);
  const [showEditorUrlDialog, setShowEditorUrlDialog] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  const isChromeBrowser = useMemo(() => {
    const ua = navigator.userAgent;
    return ua.indexOf("Chrome") > -1 && ua.indexOf("Edge") === -1;
  }, []);

  const { apiCall } = useAuth();

  const genUrl = useCallback(async () => {
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
    async (e: MouseEvent) => {
      e.preventDefault();

      setShowExtensionDialog(false);

      setIsNavigating(true);

      const url = await genUrl();
      const key = await getVisualEditorKey();

      window.postMessage(
        {
          type: "GB_OPEN_VISUAL_EDITOR",
          data: key,
        },
        window.location.origin
      );

      setIsNavigating(false);

      track("Open visual editor", {
        source: "visual-editor-ui",
        status: "success",
      });

      window.location.href = url;
    },
    [genUrl, getVisualEditorKey]
  );

  return (
    <>
      <span
        className="btn btn-sm btn-primary"
        style={{ width: "144px" }}
        onClick={async (e) => {
          const isExtensionInstalled = await isChromeExtInstalledLocally();

          if (!isExtensionInstalled) {
            e.preventDefault();
            setShowExtensionDialog(true);
            track("Open visual editor", {
              source: "visual-editor-ui",
              status: "missing extension",
            });
            return false;
          }

          navigate(e);
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
        <Modal
          open
          header="GrowthBook DevTools Extension"
          close={() => setShowExtensionDialog(false)}
          closeCta="Close"
          cta="View extension"
          submit={
            isChromeBrowser
              ? () => {
                  window.open(CHROME_EXTENSION_LINK);
                }
              : undefined
          }
        >
          {isChromeBrowser ? (
            <>
              You&apos;ll need to install the GrowthBook DevTools Chrome
              extension to use the visual editor.{" "}
              <a href="#" onClick={navigate} target="_blank" rel="noreferrer">
                Click here to proceed anyway
              </a>
              .
            </>
          ) : (
            <>
              The Visual Editor is currently only supported in Chrome. We are
              working on bringing the Visual Editor to other browsers.{" "}
              <a href={CHROME_EXTENSION_LINK} target="_blank" rel="noreferrer">
                Click here to proceed anyway
              </a>
              .
            </>
          )}
        </Modal>
      )}
    </>
  );
};

export default OpenVisualEditorLink;
