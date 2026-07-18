import { useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { getApiHost, getAppOrigin } from "@/services/env";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import LoadingSpinner from "@/components/LoadingSpinner";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";

// Lightweight "link the browser extension" page. The GrowthBook Visual
// Editor Chrome extension opens this URL in a new tab to connect:
// because the user already has a logged-in session here, we mint their
// Visual Editor API key server-side and hand it to the extension's
// content script via postMessage — no hand-copying a token.
//
// The mint + postMessage is gated behind an explicit confirmation
// click. Users who belong to multiple GrowthBook organizations can
// pick which one to connect to before confirming (the minted PAT is
// org-scoped, so the choice matters). Single-org users see the same
// confirmation screen minus the picker.
//
// The page is auth-gated like any other (no preAuth flag), so an
// unauthenticated visitor is bounced to login and returned here
// afterward — which is exactly the "assuming they're logged in"
// connect path.
//
// Sender-origin validation lives in the extension's content script,
// which re-checks `event.origin` before persisting anything — so
// even though the message reaches every same-window listener, only
// the extension's trusted listener acts on it.

type Status = "confirming" | "connecting" | "done" | "error";

const VisualEditorConnectPage = () => {
  const { apiCall, orgId, organizations, setOrgId } = useAuth();
  const { name, email, organization } = useUser();

  const [status, setStatus] = useState<Status>("confirming");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Guard against React 18 StrictMode's double-invoke in dev so a quick
  // double-click on Connect doesn't double-mint + double-post.
  const inFlightRef = useRef(false);

  // The org dropdown drives both the UI display and the X-Organization
  // header on the eventual /visual-editor/key call. We keep it in sync
  // with the auth context — switching here calls setOrgId, which
  // propagates to every subsequent apiCall.
  const orgOptions = useMemo(
    () =>
      (organizations || []).map((o) => ({
        value: o.id,
        label: o.name || o.id,
      })),
    [organizations],
  );

  const currentOrgName =
    organization?.name ||
    orgOptions.find((o) => o.value === orgId)?.label ||
    "—";

  const onSwitchOrg = (newOrgId: string) => {
    if (!setOrgId || newOrgId === orgId) return;
    setOrgId(newOrgId);
    // Mirror TopNav's behavior so future logins / page loads remember
    // this choice. Without this, the next time the user visits
    // GrowthBook the auth bootstrap picks whichever org came first in
    // the API response, which can disagree with what they just chose
    // for the extension.
    try {
      localStorage.setItem("gb-last-picked-org", `"${newOrgId}"`);
    } catch (e) {
      // Best-effort — localStorage can be blocked in some browser modes.
      console.warn("Unable to save last org in localStorage");
    }
  };

  const onConfirm = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus("connecting");
    try {
      const res = await apiCall<{ key: string }>("/visual-editor/key", {
        method: "GET",
      });
      const apiKey = res?.key;
      if (!apiKey) {
        throw new Error("Could not create a Visual Editor API key.");
      }
      // Hand the host + key (and our own origin, so the extension
      // learns where to send the user for future reconnects) to the
      // content script. Scope the targetOrigin to our own origin so
      // the message can't be observed by an iframe on a different
      // origin. The content script re-validates event.origin before
      // persisting.
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
    } finally {
      inFlightRef.current = false;
    }
  };

  // While the auth bootstrap is still resolving (orgId not yet set),
  // show a loading state so we don't flash an "—" org name and a
  // disabled button. We treat the unresolved state as a separate
  // visual mode rather than its own Status value so the
  // confirm/connecting/done/error flow stays uncluttered.
  const ready = !!orgId;

  return (
    <Flex align="center" justify="center" px="4" style={{ minHeight: "70vh" }}>
      <Box style={{ maxWidth: 520, width: "100%" }}>
        {!ready && (
          <Flex direction="column" align="center" gap="3">
            <LoadingSpinner />
            <Text as="p" color="text-mid" align="center">
              Loading your organizations…
            </Text>
          </Flex>
        )}

        {ready && status === "confirming" && (
          <Flex direction="column" gap="4">
            <Box>
              <Heading as="h1" size="large" mb="2">
                Connect the Visual Editor extension
              </Heading>
              <Text as="p" color="text-mid">
                The Visual Editor browser extension is asking to connect to
                GrowthBook. Confirm the organization below and we&rsquo;ll
                create an API key automatically — no copy/paste needed.
              </Text>
            </Box>

            <Box
              p="4"
              style={{
                border: "1px solid var(--slate-a5)",
                borderRadius: 8,
                background: "var(--color-panel-solid)",
              }}
            >
              <Text size="small" color="text-mid" as="p" mb="1">
                Connecting to
              </Text>
              <Heading as="h2" size="medium" mb="2">
                {currentOrgName}
              </Heading>
              {(name || email) && (
                <Text size="small" color="text-mid" as="p">
                  as {name ? `${name} (${email})` : email}
                </Text>
              )}

              {orgOptions.length > 1 && (
                <Box mt="3">
                  <Text size="small" color="text-mid" as="p" mb="1">
                    Not the right organization?
                  </Text>
                  <SelectField
                    value={orgId || ""}
                    options={orgOptions}
                    onChange={onSwitchOrg}
                    sort={false}
                    isSearchable={orgOptions.length > 5}
                  />
                </Box>
              )}
            </Box>

            <Flex gap="3" align="center">
              <Button onClick={onConfirm}>Connect to {currentOrgName}</Button>
              <Text size="small" color="text-mid">
                You can revoke access at any time from your account settings.
              </Text>
            </Flex>
          </Flex>
        )}

        {ready && status === "connecting" && (
          <Flex direction="column" align="center" gap="3">
            <LoadingSpinner />
            <Heading as="h1" size="medium" align="center" mb="0">
              Connecting…
            </Heading>
            <Text as="p" color="text-mid" align="center">
              Linking {currentOrgName} to your browser extension.
            </Text>
          </Flex>
        )}

        {ready && status === "done" && (
          <Flex direction="column" align="center" gap="3">
            <Heading as="h1" size="large" align="center" mb="0">
              You&rsquo;re connected
            </Heading>
            <Text as="p" color="text-mid" align="center">
              The GrowthBook Visual Editor extension is now linked to{" "}
              <strong>{currentOrgName}</strong>. You can close this tab and
              return to the Visual Editor side panel.
            </Text>
            <Callout status="info" mt="2">
              Didn&rsquo;t see the extension update? Make sure the GrowthBook
              Visual Editor extension is installed and its side panel is open,
              then reload this page.
            </Callout>
          </Flex>
        )}

        {ready && status === "error" && (
          <Flex direction="column" align="center" gap="3">
            <Heading as="h1" size="large" align="center" mb="0">
              Couldn&rsquo;t connect
            </Heading>
            <Callout status="error">
              {errorMsg ||
                "Something went wrong while creating your Visual Editor key."}
            </Callout>
            <Flex gap="2">
              <Button
                onClick={() => {
                  setErrorMsg("");
                  setStatus("confirming");
                }}
              >
                Try again
              </Button>
            </Flex>
            <Text as="p" color="text-mid" align="center">
              You can also connect manually: open the extension&rsquo;s
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
