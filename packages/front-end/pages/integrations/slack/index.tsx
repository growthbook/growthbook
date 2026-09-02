import React, { useCallback, useEffect, useRef, useState } from "react";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { SlackIntegrationsListViewContainer } from "@/components/SlackIntegrations/SlackIntegrationsListView/SlackIntegrationsListView";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";

const getQueryStringValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const SlackIntegrationsPage: NextPage = () => {
  const permissionsUtils = usePermissionsUtil();
  const router = useRouter();
  const { apiCall } = useAuth();
  const callbackProcessed = useRef(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!router.isReady || callbackProcessed.current) return;

    const slackError = getQueryStringValue(router.query.error);
    if (slackError) {
      callbackProcessed.current = true;
      setConnectError(`Slack authorization failed: ${slackError}`);
      router.replace("/integrations/slack", undefined, { shallow: true });
      return;
    }

    const code = getQueryStringValue(router.query.code);
    if (!code) return;

    const state = getQueryStringValue(router.query.state);
    callbackProcessed.current = true;
    if (!state) {
      setConnectError(
        "This Slack install was not started from GrowthBook. Start the connection from this page.",
      );
      router.replace("/integrations/slack", undefined, { shallow: true });
      return;
    }

    setConnecting(true);
    setConnectError(null);
    apiCall("/integrations/slack/oauth-callback", {
      method: "POST",
      body: JSON.stringify({ code, state }),
    })
      .then(() => {
        setConnected(true);
      })
      .catch((error: unknown) => {
        setConnectError(
          error instanceof Error
            ? error.message
            : "Failed to connect the Slack workspace.",
        );
      })
      .finally(() => {
        setConnecting(false);
        router.replace("/integrations/slack", undefined, { shallow: true });
      });
  }, [apiCall, router]);

  const connectToSlack = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const response = await apiCall<{ url: string }>(
        "/integrations/slack/connect",
        { method: "POST" },
      );
      window.location.assign(response.url);
    } catch (error) {
      setConnectError(
        error instanceof Error
          ? error.message
          : "Failed to start the Slack connection.",
      );
      setConnecting(false);
    }
  }, [apiCall]);

  if (!permissionsUtils.canManageIntegrations()) {
    return (
      <div className="container-fluid pagecontents">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </div>
    );
  }
  return (
    <div className="container-fluid pagecontents">
      {connectError && (
        <Callout status="error" mb="4">
          {connectError}
        </Callout>
      )}
      {connected && (
        <Callout status="success" mb="4">
          Slack workspace connected successfully.
        </Callout>
      )}
      <Button onClick={connectToSlack} loading={connecting} mb="4">
        Connect Slack workspace
      </Button>
      <SlackIntegrationsListViewContainer />
    </div>
  );
};

export default SlackIntegrationsPage;
