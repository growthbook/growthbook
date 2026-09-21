import { useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { FaSlack } from "react-icons/fa";
import { getApiHost, getAppOrigin } from "@/services/env";
import Code from "@/components/SyntaxHighlighting/Code";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import { buildSlackAppManifest } from "./slackSetupUtils";

const SLACK_CREATE_APP_URL = "https://api.slack.com/apps?new_app=1";

function SlackManifestModal({ onClose }: { onClose: () => void }) {
  const manifest = useMemo(() => {
    const appUrl = getAppOrigin();
    const apiUrl = getApiHost();
    return buildSlackAppManifest({ appUrl, apiUrl });
  }, []);

  return (
    <ModalStandard
      trackingEventModalType="slack-app-manifest"
      open={true}
      size="lg"
      header="Set Up the GrowthBook Slack App"
      close={onClose}
      closeCta="Done"
    >
      <Text as="p" color="text-mid" mb="3">
        Self-hosted GrowthBook connects through your own Slack app. This
        manifest includes this instance&rsquo;s URLs.
      </Text>
      <ol style={{ paddingLeft: "1.2rem", margin: "0 0 1rem" }}>
        <li>
          <Text>
            In Slack, open{" "}
            <Link href={SLACK_CREATE_APP_URL} external={true}>
              Your Apps → Create New App
            </Link>
            , choose <strong>From a manifest</strong>, and pick your workspace.
          </Text>
        </li>
        <li>
          <Text>Paste the manifest below and create the app.</Text>
        </li>
        <li>
          <Text>
            Under <strong>Basic Information → App Credentials</strong>, copy the
            Client ID, Client Secret, and Signing Secret into{" "}
            <code>SLACK_CLIENT_ID</code>, <code>SLACK_CLIENT_SECRET</code>, and{" "}
            <code>SLACK_SIGNING_SECRET</code> on your API server.
          </Text>
        </li>
        <li>
          <Text>
            Restart GrowthBook, then open <strong>Event Subscriptions</strong>{" "}
            in your Slack app settings and verify the Request URL. Slack must be
            able to reach your API server over HTTPS.
          </Text>
        </li>
        <li>
          <Text>
            Reload this page and connect your Slack workspace. The assistant
            follows your organization&apos;s AI setting unless you turn it off
            in the workspace settings.
          </Text>
        </li>
      </ol>
      <Code
        code={manifest}
        language="yml"
        filename="growthbook-slack-manifest.yml"
      />
      <Callout status="info" mt="3">
        Mention the bot in channels to ask a question. You can also DM it.
      </Callout>
    </ModalStandard>
  );
}

export default function SlackAppSetup() {
  const [showManifest, setShowManifest] = useState(false);
  return (
    <>
      {showManifest && (
        <SlackManifestModal onClose={() => setShowManifest(false)} />
      )}
      <Flex direction="column" gap="3" align="center" p="5">
        <Heading as="h2" size="sm" mb="0">
          Finish Self-Hosted Slack Setup
        </Heading>
        <Text color="text-mid" align="center">
          Create your Slack app from a manifest pre-filled for this instance,
          set its credentials on your API server, and restart GrowthBook.
        </Text>
        <Button
          icon={<FaSlack aria-hidden />}
          onClick={() => setShowManifest(true)}
        >
          Set up Slack app
        </Button>
      </Flex>
    </>
  );
}
