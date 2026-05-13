import { useState } from "react";
import { NextPage } from "next";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Field from "@/components/Forms/Field";

type HelloWorldResult =
  | { ok: true; ts: string; channel: string }
  | { ok: false; error: string };

const DEFAULT_CHANNEL = "#hackweek-slack-bot";

const SlackTestPage: NextPage = () => {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const [channel, setChannel] = useState(DEFAULT_CHANNEL);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HelloWorldResult | null>(null);

  if (!permissionsUtil.canManageIntegrations()) {
    return (
      <div className="container-fluid pagecontents">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </div>
    );
  }

  const onSend = async () => {
    setLoading(true);
    setResult(null);
    try {
      const r = await apiCall<HelloWorldResult>(
        "/admin/slack-test/hello-world",
        {
          method: "POST",
          body: JSON.stringify({ channel }),
        },
      );
      setResult(r);
    } catch (e) {
      setResult({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container-fluid pagecontents">
      <Box p="4">
        <Heading as="h1" mb="2">
          Slack bot integration test
        </Heading>
        <Box mb="4">
          Send a Block Kit &ldquo;Hello World&rdquo; message to a Slack channel
          via <code>chat.postMessage</code> using the configured{" "}
          <code>SLACK_BOT_TOKEN</code>. Add the bot to the target channel first.
        </Box>
        <Flex direction="column" gap="3" maxWidth="480px">
          <Field
            label="Slack channel (id or #name)"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="C0123456789 or #growthbook-test"
          />
          <Box>
            <Button onClick={onSend} disabled={loading || !channel}>
              {loading ? "Sending…" : "Send Hello World"}
            </Button>
          </Box>

          {result?.ok && (
            <Callout status="success">
              Sent to <code>{result.channel}</code> (ts:{" "}
              <code>{result.ts}</code>)
            </Callout>
          )}
          {result && !result.ok && (
            <Callout status="error">{result.error}</Callout>
          )}
        </Flex>
      </Box>
    </div>
  );
};

export default SlackTestPage;
