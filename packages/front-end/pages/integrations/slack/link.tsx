import { useRef, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import LoadingSpinner from "@/components/LoadingSpinner";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

// Slack account-link consent page. The bot sends an unlinked user here with a
// signed `state`; confirming (while logged in to GrowthBook) records "this
// Slack user IS this GrowthBook account", so the assistant acts as them without
// trusting the spoofable Slack profile email.
//
// Auth-gated (no preAuth flag), so an unauthenticated visitor logs in first.
// Users in multiple orgs pick which one to link before confirming.

type Status = "confirming" | "linking" | "done" | "error";

function getQueryValue(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] || "" : v || "";
}

const SlackLinkPage = () => {
  const router = useRouter();
  const { apiCall, orgId } = useAuth();
  const { name, email } = useUser();

  const state = getQueryValue(router.query.state);

  const [status, setStatus] = useState<Status>("confirming");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const inFlightRef = useRef(false);

  const onConfirm = async () => {
    if (inFlightRef.current || !state) return;
    inFlightRef.current = true;
    setStatus("linking");
    try {
      await apiCall("/integrations/slack/link", {
        method: "POST",
        body: JSON.stringify({ state }),
      });
      setStatus("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
    } finally {
      inFlightRef.current = false;
    }
  };

  const ready = !!orgId;

  return (
    <Flex align="center" justify="center" px="4" style={{ minHeight: "70vh" }}>
      <Box style={{ maxWidth: 520, width: "100%" }}>
        {!state && (
          <Callout status="error">
            Missing link token. Mention the GrowthBook bot in Slack again to get
            a fresh link.
          </Callout>
        )}

        {state && !ready && (
          <Flex direction="column" align="center" gap="3">
            <LoadingSpinner />
            <Text as="p" color="text-mid" align="center">
              Loading your organizations…
            </Text>
          </Flex>
        )}

        {state && ready && status === "confirming" && (
          <Flex direction="column" gap="4">
            <Box>
              <Heading as="h1" size="lg" mb="2">
                Link your Slack account
              </Heading>
              <Text as="p" color="text-mid">
                The GrowthBook Slack bot wants to link your Slack identity to
                your GrowthBook account so it can answer as you, with your
                permissions.
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
              <Text size="sm" color="text-mid" as="p" mb="1">
                Linking as
              </Text>
              <Heading as="h2" size="md" mb="2">
                {name ? `${name} (${email})` : email || "your account"}
              </Heading>
              <Text size="sm" color="text-mid" as="p">
                This links your identity, not one organization. In each Slack
                channel the bot answers within the organization that channel is
                connected to — and only if you&rsquo;re a member of it.
              </Text>
            </Box>

            <Flex gap="3" align="center">
              <Button onClick={onConfirm}>Link my account</Button>
              <Text size="sm" color="text-mid">
                You can unlink at any time.
              </Text>
            </Flex>
          </Flex>
        )}

        {state && ready && status === "linking" && (
          <Flex direction="column" align="center" gap="3">
            <LoadingSpinner />
            <Heading as="h1" size="md" align="center" mb="0">
              Linking…
            </Heading>
          </Flex>
        )}

        {state && status === "done" && (
          <Flex direction="column" align="center" gap="3">
            <Heading as="h1" size="lg" align="center" mb="0">
              You&rsquo;re linked
            </Heading>
            <Text as="p" color="text-mid" align="center">
              Your Slack account is now linked to GrowthBook. You can close this
              tab and go back to Slack.
            </Text>
          </Flex>
        )}

        {state && status === "error" && (
          <Flex direction="column" align="center" gap="3">
            <Heading as="h1" size="lg" align="center" mb="0">
              Couldn&rsquo;t link
            </Heading>
            <Callout status="error">
              {errorMsg || "Something went wrong linking your Slack account."}
            </Callout>
            <Button
              onClick={() => {
                setErrorMsg("");
                setStatus("confirming");
              }}
            >
              Try again
            </Button>
          </Flex>
        )}
      </Box>
    </Flex>
  );
};

export default SlackLinkPage;
