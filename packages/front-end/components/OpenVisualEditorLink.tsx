import { FC, useMemo, useState } from "react";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { PiArrowSquareOut } from "react-icons/pi";
import { getApiHost, getAppOrigin } from "@/services/env";
import track from "@/services/track";
import { appendQueryParamsToURL } from "@/services/utils";
import { AuthContextValue, useAuth } from "@/services/auth";
import RadixButton from "@/ui/Button";
import Link from "@/ui/Link";
import Modal from "./Modal";
import Button from "./Button";

// The standalone GrowthBook Visual Editor extension (Chrome side panel).
// This replaced the old DevTools extension's bundled in-page editor.
export const VISUAL_EDITOR_EXTENSION_LINK =
  "https://chromewebstore.google.com/detail/growthbook-visual-editor/nbomejknbpkcpjdagefhichaajpoempk";

// The GrowthBook DevTools extension — still the tool for debugging feature
// flags, experiments, attributes, and SDK health. Only its bundled visual
// editor is deprecated (replaced by the standalone extension above).
export const CHROME_EXTENSION_LINK =
  "https://chrome.google.com/webstore/detail/growthbook-devtools/opemhndcehfgipokneipaafbglcecjia";
export const FIREFOX_EXTENSION_LINK =
  "https://addons.mozilla.org/en-US/firefox/addon/growthbook-devtools/";

type OpenVisualEditorResponse =
  | { error: "INVALID_BROWSER" }
  | { error: "NO_URL" }
  | { error: "NO_EXTENSION" };

// Presence probe for the standalone Visual Editor extension. Does a post a ping
// on the page and wait for the pong its content
function pingVisualEditorExtension(timeoutMs = 500): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (found: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      resolve(found);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const d = event.data as { type?: string } | undefined;
      if (d?.type === "GB_VISUAL_EDITOR_PONG") finish(true);
    };
    window.addEventListener("message", onMessage);
    window.postMessage(
      { type: "GB_PING_VISUAL_EDITOR" },
      window.location.origin,
    );
    setTimeout(() => finish(false), timeoutMs);
  });
}

// True if a Visual Editor extension capable of handling the launch is
// installed. Prefers the new standalone extension (ping/pong); falls back
// to probing the legacy DevTools extension's web-accessible icon
async function isVisualEditorExtensionInstalled(
  browser: string,
): Promise<boolean> {
  if (await pingVisualEditorExtension()) return true;
  if (browser === "chrome") {
    try {
      const res = await fetch(
        "chrome-extension://opemhndcehfgipokneipaafbglcecjia/js/logo128.png",
        { method: "HEAD" },
      );
      if (res?.ok) return true;
    } catch {
      // legacy extension not installed / unreachable
    }
  }
  return false;
}

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

  // Gesture beacon for the Visual Editor extension, posted synchronously
  // inside the click handler — before any await. Chrome's sidePanel.open()
  // only works within ~5s of a user gesture, and the API round-trips below
  // routinely eat that window, which made the panel's auto-open flaky.
  window.postMessage(
    { type: "GB_OPEN_VISUAL_EDITOR_CLICKED" },
    window.location.origin,
  );

  const apiHost = getApiHost();
  const { enabled: aiFeatureMeta } = await apiCall<{ enabled: boolean }>(
    `/meta/ai`,
  );
  url = appendQueryParamsToURL(url, {
    "vc-id": vc.id,
    "v-idx": 1,
    "exp-url": encodeURIComponent(window.location.href),
    ...(aiFeatureMeta ? { "ai-enabled": "true" } : {}),
  });

  // Opt-in escape hatch for engineers developing the extension itself.
  //
  //   localStorage.setItem("gb-visual-editor-dev-extension", "1")
  //
  const isExtensionDev =
    typeof window !== "undefined" &&
    window.localStorage?.getItem("gb-visual-editor-dev-extension") === "1";

  if (!bypassChecks && !isExtensionDev) {
    const installed = await isVisualEditorExtensionInstalled(browser);
    if (!installed) {
      if (browser !== "chrome" || deviceType !== "desktop") {
        track("Open visual editor", {
          source: "visual-editor-ui",
          status: "invalid browser",
          type: browser + " - " + deviceType,
        });
        return { error: "INVALID_BROWSER" };
      }
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
          // Teach the extension our app origin so its "Connect with
          // GrowthBook" button knows where to reopen for future reconnects
          // (the app origin can differ from apiHost, e.g. on self-hosted).
          appOrigin: getAppOrigin(),
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
  button?: string | JSX.Element;
}> = ({
  visualChangeset,
  openSettings,
  useRadix = true,
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
          useRadixButton={false}
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
          useRadixButton={false}
          trackingEventModalType=""
          open
          header="GrowthBook Visual Editor Extension"
          close={() => setShowExtensionDialog(false)}
          closeCta="Close"
          cta="View extension"
          submit={() => {
            window.open(VISUAL_EDITOR_EXTENSION_LINK);
          }}
        >
          {browser === "chrome" ? (
            <>
              You&apos;ll need to install the GrowthBook Visual Editor browser
              extension to use the Visual Editor.{" "}
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
              The Visual Editor extension is currently available for Chrome.
              We&apos;re working on bringing it to other browsers.
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
