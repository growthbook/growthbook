import React from "react";
import { DATADOG_API_KEY_HEADER, datadogSiteForUrl } from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import { EventWebHookInterface } from "shared/types/event-webhook";
import { EventWebHookLogInterface } from "shared/types/event-webhook-log";
import { useDefinitions } from "@/services/DefinitionsContext";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { DocLink } from "@/components/DocLink";
import { headerSecretKey } from "@/components/EventWebHooks/datadog";

type Check = { ok: boolean; message: React.ReactNode };

function CheckRow({ ok, message }: Check) {
  return (
    <Flex align="start" gap="3">
      <Badge
        label={ok ? "OK" : "Check"}
        color={ok ? "green" : "amber"}
        variant="soft"
      />
      <Text>{message}</Text>
    </Flex>
  );
}

function useSecretsCheck(eventWebHook: EventWebHookInterface): Check {
  const { webhookSecrets } = useDefinitions();
  const origin = new URL(eventWebHook.url).origin;
  const host = origin.replace(/^https?:\/\//, "");

  const key = headerSecretKey(
    eventWebHook.headers ?? {},
    DATADOG_API_KEY_HEADER,
  );
  if (!key) {
    return {
      ok: false,
      message: (
        <>
          <code>{DATADOG_API_KEY_HEADER}</code> isn&apos;t set to a webhook
          secret.
        </>
      ),
    };
  }
  const secret = webhookSecrets.find((s) => s.key === key);
  if (!secret) {
    return {
      ok: false,
      message: (
        <>
          The secret <code>{key}</code> doesn&apos;t exist.
        </>
      ),
    };
  }
  if (
    secret.allowedOrigins?.length &&
    !secret.allowedOrigins.includes(origin)
  ) {
    return {
      ok: false,
      message: (
        <>
          The secret <code>{key}</code> isn&apos;t allowed for {host}.
        </>
      ),
    };
  }
  return {
    ok: true,
    message: `The API key secret exists and allows ${host}.`,
  };
}

function serviceCheck(service: string | undefined): Check {
  return service
    ? {
        ok: true,
        message: (
          <>
            Changes show on the <code>{service}</code> service.
          </>
        ),
      }
    : {
        ok: false,
        message:
          "No Datadog service is set. Changes reach Event Explorer but no service page.",
      };
}

export default function DatadogWebhookChecks({
  eventWebHook,
  logs,
}: {
  eventWebHook: EventWebHookInterface;
  logs: EventWebHookLogInterface[];
}) {
  const secretsCheck = useSecretsCheck(eventWebHook);

  const site = datadogSiteForUrl(eventWebHook.url);
  const lastDelivery = logs[0];
  const authFailed =
    lastDelivery?.result === "error" &&
    (lastDelivery.responseCode === 401 || lastDelivery.responseCode === 403);

  return (
    <Box mt="3">
      <Flex direction="column" gap="2">
        <CheckRow {...secretsCheck} />
        <CheckRow {...serviceCheck(eventWebHook.datadog?.service)} />
      </Flex>
      {authFailed && (
        <Callout status="error" mt="3">
          Last delivery failed: {lastDelivery.responseCode}. Check the API key,
          and that the site matches your Datadog account.
        </Callout>
      )}
      <Flex gap="4" mt="3">
        {site && (
          <Link href={`https://${site.app}/event/explorer`} external>
            Open in Datadog
          </Link>
        )}
        <DocLink docSection="datadogRollbacks">
          Set up rollbacks from Datadog monitors
        </DocLink>
      </Flex>
    </Box>
  );
}
