import { useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { FaSlack } from "react-icons/fa";
import { getAppOrigin } from "@/services/env";
import Code from "@/components/SyntaxHighlighting/Code";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import { buildSlackAppManifest } from "./slackSetupUtils";

const SLACK_CREATE_APP_URL = "https://api.slack.com/apps?new_app=1";

function SlackManifestModal({
  onClose,
  scopes,
}: {
  onClose: () => void;
  scopes: string[];
}) {
  const manifest = useMemo(() => {
    const appUrl = getAppOrigin();
    return buildSlackAppManifest({ appUrl, scopes });
  }, [scopes]);

  return (
    <ModalStandard
      trackingEventModalType="slack-app-manifest"
      open={true}
      size="lg"
      header="Set Up the GrowthBook Slack App"
      close={onClose}
      closeCta="Done"
      secondaryAction={
        <Button
          variant="outline"
          icon={<FaSlack />}
          onClick={() => window.open(SLACK_CREATE_APP_URL, "_blank")}
        >
          Open Slack app dashboard
        </Button>
      }
    >
      <Text as="p" color="text-mid" mb="3">
        Self-hosted GrowthBook connects through your own Slack app. This
        manifest is pre-filled with this instance&rsquo;s URLs — no editing
        required.
      </Text>
      <ol style={{ paddingLeft: "1.2rem", margin: "0 0 1rem" }}>
        <li>
          <Text>
            In Slack, open{" "}
            <strong>Your Apps → Create New App → From a manifest</strong> and
            pick your workspace.
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
          <Text>Restart GrowthBook and reload this page to connect.</Text>
        </li>
      </ol>
      <Code
        code={manifest}
        language="yml"
        filename="growthbook-slack-manifest.yml"
      />
      <Callout status="info" mt="3">
        This manifest configures OAuth and notification delivery. AI assistant
        event subscriptions and interactivity require additional setup after
        enabling the assistant. Set SLACK_SIGNING_SECRET before configuring
        those inbound requests.
      </Callout>
    </ModalStandard>
  );
}

export default function SlackAppSetup({ scopes }: { scopes: string[] }) {
  const [showManifest, setShowManifest] = useState(false);
  return (
    <>
      {showManifest && (
        <SlackManifestModal
          scopes={scopes}
          onClose={() => setShowManifest(false)}
        />
      )}
      <Flex direction="column" gap="3" align="center" p="5">
        <Heading as="h2" size="sm" mb="0">
          Finish Self-Hosted Slack Setup
        </Heading>
        <Text color="text-mid" align="center">
          Create your Slack app from a manifest pre-filled for this instance,
          set its credentials on your API server, and restart GrowthBook.
        </Text>
        <Button icon={<FaSlack />} onClick={() => setShowManifest(true)}>
          Set up Slack app
        </Button>
      </Flex>
    </>
  );
}
