import { useEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { getApiHost, getAppOrigin } from "@/services/env";
import { useAuth } from "@/services/auth";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

// Lightweight "link the browser extension" page. The GrowthBook Visual
// Editor Chrome extension opens this URL in a new tab to (re)connect:
// because the user already has a logged-in session here, we mint their
// Visual Editor API key server-side and hand it to the extension's content
// script via postMessage — no hand-copying a token.
//
// This reuses the exact message the content script already trusts
// (GB_REQUEST_OPEN_VISUAL_EDITOR, the same one the "Open Visual Editor"
// button sends). The content script re-validates the sending origin before
// storing anything, so a malicious page can't use this to inject creds.
//
// The page is auth-gated like any other (no preAuth flag), so an
// unauthenticated visitor is bounced to login and returned here afterward —
// which is exactly the "assuming they're logged in" reconnect path.

type Status = "working" | "done" | "error";

const VisualEditorConnectPage = () => {
  const { apiCall } = useAuth();
  const [status, setStatus] = useState<Status>("working");
  const [errorMsg, setErrorMsg] = useState<string>("");
  // Guard against React 18 StrictMode's double-invoke in dev so we don't
  // mint + postMessage twice.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void (async () => {
      try {
        const res = await apiCall<{ key: string }>("/visual-editor/key", {
          method: "GET",
        });
        const apiKey = res?.key;
        if (!apiKey) {
          throw new Error("Could not create a Visual Editor API key.");
        }
        // Hand the host + key (and our own origin, so the extension learns
        // where to send the user for future reconnects) to the content
        // script. Scope the targetOrigin to our own origin.
        window.postMessage(
          {
            type: "GB_REQUEST_OPEN_VISUAL_EDITOR",
            data: {
              apiHost: getApiHost(),
              apiKey,
              appOrigin: getAppOrigin(),
            },
          },
          window.location.origin,
        );
        // Give the content script a beat to receive + persist before we
        // tell the user it's safe to close the tab.
        await new Promise((r) => setTimeout(r, 500));
        setStatus("done");
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
  }, [apiCall]);

  return (
    <Flex align="center" justify="center" px="4" style={{ minHeight: "70vh" }}>
      <Box style={{ maxWidth: 480, width: "100%" }}>
        {status === "working" && (
          <Flex direction="column" align="center" gap="3">
            <LoadingSpinner />
            <Heading as="h1" size="medium" align="center" mb="0">
              Connecting the Visual Editor…
            </Heading>
            <Text as="p" color="text-mid" align="center">
              Linking this GrowthBook account to your browser extension.
            </Text>
          </Flex>
        )}

        {status === "done" && (
          <Flex direction="column" align="center" gap="3">
            <Heading as="h1" size="large" align="center" mb="0">
              You&rsquo;re connected
            </Heading>
            <Text as="p" color="text-mid" align="center">
              The GrowthBook Visual Editor extension is now linked to this
              account. You can close this tab and return to the Visual Editor
              side panel.
            </Text>
            <Callout status="info" mt="2">
              Didn&rsquo;t see the extension update? Make sure the GrowthBook
              Visual Editor extension is installed and its side panel is open,
              then reload this page.
            </Callout>
          </Flex>
        )}

        {status === "error" && (
          <Flex direction="column" align="center" gap="3">
            <Heading as="h1" size="large" align="center" mb="0">
              Couldn&rsquo;t connect
            </Heading>
            <Callout status="error">
              {errorMsg ||
                "Something went wrong while creating your Visual Editor key."}
            </Callout>
            <Text as="p" color="text-mid" align="center">
              You can still connect manually: open the extension&rsquo;s
              connection menu and paste your API host and a personal access
              token.
            </Text>
          </Flex>
        )}
      </Box>
    </Flex>
  );
};

export default VisualEditorConnectPage;
