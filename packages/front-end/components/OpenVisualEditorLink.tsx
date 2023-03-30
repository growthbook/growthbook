import { FC, useMemo, useState } from "react";
import qs from "query-string";
import { FaExternalLinkAlt } from "react-icons/fa";
import { getApiHost } from "@/services/env";
import track from "@/services/track";
import Modal from "./Modal";

// TODO - parameterize this
const CHROME_EXTENSION_LINK =
  "https://chrome.google.com/webstore/detail/growthbook-devtools/opemhndcehfgipokneipaafbglcecjia";

const OpenVisualEditorLink: FC<{
  visualEditorUrl?: string;
  id: string;
  openSettings?: () => void;
  changeIndex: number;
}> = ({ id, visualEditorUrl, openSettings, changeIndex }) => {
  const apiHost = getApiHost();
  const [showExtensionDialog, setShowExtensionDialog] = useState(false);
  const [showEditorUrlDialog, setShowEditorUrlDialog] = useState(false);

  const isChromeBrowser = useMemo(() => {
    const ua = navigator.userAgent;
    return ua.indexOf("Chrome") > -1 && ua.indexOf("Edge") === -1;
  }, []);

  const url = useMemo(() => {
    if (!visualEditorUrl) return "";

    const parsed = qs.parse(
      visualEditorUrl.indexOf("?") > -1 ? visualEditorUrl.split("?")[1] : ""
    );

    const queryParams = {
      ...parsed,
      "vc-id": id,
      "v-idx": changeIndex,
      "exp-url": encodeURIComponent(window.location.href),
      "api-host": encodeURIComponent(apiHost),
    };

    const root = visualEditorUrl.split("?")[0];

    return `${root}?${qs.stringify(queryParams)}`;
  }, [visualEditorUrl, id, changeIndex, apiHost]);

  return (
    <>
      <span
        className="btn btn-sm btn-primary"
        onClick={async (e) => {
          if (!visualEditorUrl) {
            e.preventDefault();
            setShowEditorUrlDialog(true);
            track("Open visual editor", {
              source: "visual-editor-ui",
              status: "missing visualEditorUrl",
            });
            return false;
          }

          let isExtensionInstalled = false;
          await fetch(
            "chrome-extension://opemhndcehfgipokneipaafbglcecjia/js/logo192.png",
            {
              method: "HEAD",
            }
          )
            .then((resp) => {
              if (resp.status === 200) {
                isExtensionInstalled = true;
              }
            })
            .catch((e) => {
              console.log("chrome extension check failed", e.message);
            });

          if (!isExtensionInstalled) {
            e.preventDefault();
            setShowExtensionDialog(true);
            track("Open visual editor", {
              source: "visual-editor-ui",
              status: "missing extension",
            });
            return false;
          }

          if (url) {
            track("Open visual editor", {
              source: "visual-editor-ui",
              status: "success",
            });
            window.location.href = url;
          }
        }}
      >
        Open Visual Editor <FaExternalLinkAlt />
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
            `You'll need to install the GrowthBook DevTools Chrome extension
          to use the visual editor.`
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
