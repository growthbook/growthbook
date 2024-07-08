import { FC, useMemo, useState } from "react";
import { FaExternalLinkAlt } from "react-icons/fa";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { getApiHost } from "@/services/env";
import track from "@/services/track";
import { appendQueryParamsToURL } from "@/services/utils";
import { AuthContextValue, useAuth } from "@/services/auth";
import { growthbook } from "@/pages/_app";
import Modal from "./Modal";
import Button from "./Button";

const CHROME_EXTENSION_LINK =
  "https://chrome.google.com/webstore/detail/growthbook-devtools/opemhndcehfgipokneipaafbglcecjia";

type OpenVisualEditorResponse =
  | { error: "NOT_CHROME" }
  | { error: "NO_URL" }
  | { error: "NO_EXTENSION" };

export async function openVisualEditor(
  vc: VisualChangesetInterface,
  apiCall: AuthContextValue["apiCall"],
  bypassChecks: boolean = false
): Promise<null | OpenVisualEditorResponse> {
  let url = vc.editorUrl.trim();
  if (!url) {
    track("Open visual editor", {
      source: "visual-editor-ui",
      status: "missing visualEditorUrl",
    });
    return { error: "NO_URL" };
  }
  // Force all URLs to be absolute
  if (!url.match(/^http(s)?:/)) {
    // We could use https here, but then it would break for people testing on localhost
    // Most sites redirect http to https, so this should work almost everywhere
    url = "http://" + url;
  }

  const apiHost = getApiHost();
  const { enabled: aiFeatureMeta } = await apiCall<{ enabled: boolean }>(
    `/meta/ai`
  );
  const isAiFeatureEnabled = growthbook.isOn("visual-editor-ai-enabled");

  url = appendQueryParamsToURL(url, {
    "vc-id": vc.id,
    "v-idx": 1,
    "exp-url": encodeURIComponent(window.location.href),
    ...(aiFeatureMeta && isAiFeatureEnabled ? { "ai-enabled": "true" } : {}),
  });

  if (!bypassChecks) {
    const ua = navigator.userAgent;
    const isChromeBrowser =
      ua.indexOf("Chrome") > -1 && ua.indexOf("Edge") === -1;
    if (!isChromeBrowser) {
      track("Open visual editor", {
        source: "visual-editor-ui",
        status: "not chrome",
      });
      return { error: "NOT_CHROME" };
    }

    try {
      const res = await fetch(
        "chrome-extension://opemhndcehfgipokneipaafbglcecjia/js/logo192.png",
        { method: "HEAD" }
      );
      if (!res.ok) {
        throw new Error("Could not reach extension");
      }
    } catch (e) {
      track("Open visual editor", {
        source: "visual-editor-ui",
        status: "no extension",
      });
      return { error: "NO_EXTENSION" };
    }
  }

  try {
    const res = await apiCall<{ key: string }>("/visual-editor/key", {
      method: "GET",
    });
    const apiKey = res.key;
    window.postMessage(
      {
        type: "GB_REQUEST_OPEN_VISUAL_EDITOR",
        data: {
          apiHost,
          apiKey,
        },
      },
      window.location.origin
    );

    // Give time for the Chrome extension to receive the API host/key
    await new Promise((resolve) => setTimeout(resolve, 300));
  } catch (e) {
    console.error("Failed to set visual editor key automatically", e);
  }

  track("Open visual editor", {
    source: "visual-editor-ui",
    status: "success",
  });
  window.location.href = url;
  return null;
}

const OpenVisualEditorLink: FC<{
  visualChangeset: VisualChangesetInterface;
  openSettings?: () => void;
}> = ({ visualChangeset, openSettings }) => {
  const [showExtensionDialog, setShowExtensionDialog] = useState(false);
  const [showEditorUrlDialog, setShowEditorUrlDialog] = useState(false);

  const { apiCall } = useAuth();

  const isChromeBrowser = useMemo(() => {
    const ua = navigator.userAgent;
    return ua.indexOf("Chrome") > -1 && ua.indexOf("Edge") === -1;
  }, []);

  return (
    <>
      <Button
        color="primary"
        className="btn-sm"
        onClick={async () => {
          const res = await openVisualEditor(visualChangeset, apiCall);
          if (!res) {
            // Stay in a loading state until window redirects
            await new Promise((resolve) => setTimeout(resolve, 5000));
            return;
          }

          if (res.error === "NO_URL") {
            setShowEditorUrlDialog(true);
            return;
          }

          if (res.error === "NO_EXTENSION" || res.error === "NOT_CHROME") {
            setShowExtensionDialog(true);
            return;
          }
        }}
      >
        Open Visual Editor <FaExternalLinkAlt />
      </Button>

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
          you click on the &quot;Open Visual Editor&quot; button.
        </Modal>
      )}

      {showExtensionDialog && (
        <Modal
          open
          header="GrowthBook DevTools Extension"
          close={() => setShowExtensionDialog(false)}
          closeCta="Close"
          cta="View extension"
          submit={() => {
            window.open(CHROME_EXTENSION_LINK);
          }}
        >
          {isChromeBrowser ? (
            <>
              You&apos;ll need to install the GrowthBook DevTools Chrome
              extension to use the visual editor.{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  openVisualEditor(visualChangeset, apiCall, true);
                }}
              >
                Click here to proceed anyway
              </a>
              .
            </>
          ) : (
            <>
              The Visual Editor is currently only supported in Chrome. We are
              working on bringing the Visual Editor to other browsers.
            </>
          )}
        </Modal>
      )}
    </>
  );
};

export default OpenVisualEditorLink;
