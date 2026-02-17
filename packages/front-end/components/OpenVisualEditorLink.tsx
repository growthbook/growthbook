import { FC, useMemo, useState } from "react";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { PiArrowSquareOut } from "react-icons/pi";
import { getApiHost } from "@/services/env";
import track from "@/services/track";
import { appendQueryParamsToURL, growthbook } from "@/services/utils";
import { AuthContextValue, useAuth } from "@/services/auth";
import RadixButton from "@/ui/Button";
import Link from "@/ui/Link";
import Modal from "./Modal";
import Button from "./Button";

export const CHROME_EXTENSION_LINK =
  "https://chrome.google.com/webstore/detail/growthbook-devtools/opemhndcehfgipokneipaafbglcecjia";
export const FIREFOX_EXTENSION_LINK =
  "https://addons.mozilla.org/en-US/firefox/addon/growthbook-devtools/";

type OpenVisualEditorResponse =
  | { error: "INVALID_BROWSER" }
  | { error: "NO_URL" }
  | { error: "NO_EXTENSION" };

export async function openVisualEditor({
  vc,
  apiCall,
  browser,
  deviceType,
  bypassChecks = false,
}: {
  vc: VisualChangesetInterface;
  apiCall: AuthContextValue["apiCall"];
  browser: string;
  deviceType: string;
  bypassChecks?: boolean;
}): Promise<null | OpenVisualEditorResponse> {
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
    `/meta/ai`,
  );
  const isAiFeatureEnabled = growthbook.isOn("visual-editor-ai-enabled");

  url = appendQueryParamsToURL(url, {
    "vc-id": vc.id,
    "v-idx": 1,
    "exp-url": encodeURIComponent(window.location.href),
    ...(aiFeatureMeta && isAiFeatureEnabled ? { "ai-enabled": "true" } : {}),
  });

  if (!bypassChecks) {
    if (!["chrome", "firefox"].includes(browser) || deviceType !== "desktop") {
      track("Open visual editor", {
        source: "visual-editor-ui",
        status: "invalid browser",
        type: browser + " - " + deviceType,
      });
      return { error: "INVALID_BROWSER" };
    }

    try {
      let res: Response | undefined = undefined;
      switch (browser) {
        case "chrome":
          res = await fetch(
            "chrome-extension://opemhndcehfgipokneipaafbglcecjia/js/logo128.png",
            { method: "HEAD" },
          );
          break;
        case "firefox":
          res = await fetch(
            "moz-extension://a69dc869-b91d-4fd3-adb2-71dc23cdc01c/js/logo128.png",
            { method: "HEAD" },
          );
          break;
      }
      if (!res?.ok) {
        throw new Error("Could not reach extension");
      }
    } catch (e) {
      track("Open visual editor", {
        source: "visual-editor-ui",
        status: "no extension",
        type: browser + " - " + deviceType,
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
      window.location.origin,
    );

    // Give time for the extension to receive the API host/key
    await new Promise((resolve) => setTimeout(resolve, 300));
  } catch (e) {
    console.error("Failed to set visual editor key automatically", e);
  }

  track("Open visual editor", {
    source: "visual-editor-ui",
    status: "success",
    type: browser + " - " + deviceType,
  });
  window.location.href = url;
  return null;
}

const OpenVisualEditorLink: FC<{
  visualChangeset: VisualChangesetInterface;
  openSettings?: () => void;
  useRadix?: boolean;
  useLink?: boolean;
  button?: string | React.ReactNode;
}> = ({
  visualChangeset,
  openSettings,
  useRadix,
  useLink,
  button = (
    <>
      Open Visual Editor
      <PiArrowSquareOut
        className="ml-1"
        style={{ position: "relative", top: "-2px" }}
      />
    </>
  ),
}) => {
  const [showExtensionDialog, setShowExtensionDialog] = useState(false);
  const [showEditorUrlDialog, setShowEditorUrlDialog] = useState(false);

  const { apiCall } = useAuth();

  const { browser, deviceType } = useMemo(() => {
    const ua = navigator.userAgent;
    return getBrowserDevice(ua);
  }, []);

  const onOpen = async () => {
    const res = await openVisualEditor({
      vc: visualChangeset,
      apiCall,
      browser,
      deviceType,
    });
    if (!res) {
      // Stay in a loading state until window redirects
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return;
    }

    if (res.error === "NO_URL") {
      setShowEditorUrlDialog(true);
      return;
    }

    if (res.error === "NO_EXTENSION" || res.error === "INVALID_BROWSER") {
      setShowExtensionDialog(true);
      return;
    }
  };

  return (
    <>
      {useLink ? (
        <Link
          href="#"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpen();
          }}
        >
          {button}
        </Link>
      ) : useRadix ? (
        <RadixButton variant="ghost" onClick={onOpen}>
          {button}
        </RadixButton>
      ) : (
        <Button color="primary" className="btn-sm" onClick={onOpen}>
          {button}
        </Button>
      )}

      {showEditorUrlDialog && openSettings && (
        <Modal
          trackingEventModalType=""
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
          trackingEventModalType=""
          open
          header="GrowthBook DevTools Extension"
          close={() => setShowExtensionDialog(false)}
          closeCta="Close"
          cta="View extension"
          submit={() => {
            if (browser === "firefox") {
              window.open(FIREFOX_EXTENSION_LINK);
            } else {
              window.open(CHROME_EXTENSION_LINK);
            }
          }}
        >
          {["chrome", "firefox"].includes(browser) ? (
            <>
              You&apos;ll need to install the GrowthBook DevTools browser
              extension to use the visual editor.{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  openVisualEditor({
                    vc: visualChangeset,
                    apiCall,
                    browser,
                    deviceType,
                    bypassChecks: true,
                  });
                }}
              >
                Click here to proceed anyway
              </a>
              .
            </>
          ) : (
            <>
              The Visual Editor is currently only supported in Chrome and
              Firefox. We are working on bringing the Visual Editor to other
              browsers.
            </>
          )}
        </Modal>
      )}
    </>
  );
};

export default OpenVisualEditorLink;

export function getBrowserDevice(ua: string): {
  browser: string;
  deviceType: string;
} {
  const browser = ua.match(/Edg/)
    ? "edge"
    : ua.match(/Chrome/)
      ? "chrome"
      : ua.match(/Firefox/)
        ? "firefox"
        : ua.match(/Safari/)
          ? "safari"
          : "unknown";

  const deviceType = ua.match(/Mobi/) ? "mobile" : "desktop";

  return { browser, deviceType };
}
