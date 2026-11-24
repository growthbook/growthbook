import React from "react";
import {
  DATADOG_API_KEY_HEADER,
  datadogSiteForUrl,
  getDatadogServiceNames,
} from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import { EventWebHookInterface } from "shared/types/event-webhook";
import { EventWebHookLogInterface } from "shared/types/event-webhook-log";
import { useFeatureMetaInfo } from "@/hooks/useFeatureMetaInfo";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCustomFields } from "@/hooks/useCustomFields";
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

function useServiceFieldCheck(serviceField: string | undefined): Check {
  const field = useCustomFields().find((f) => f.id === serviceField);
  if (!serviceField) {
    return {
      ok: false,
      message:
        "No service field. Changes reach Event Explorer but no service page.",
    };
  }
  if (!field) {
    return {
      ok: false,
      message: (
        <>
          The service field <code>{serviceField}</code> no longer exists.
        </>
      ),
    };
  }
  const missing = [
    !field.sections.includes("feature") && "Feature Flags",
    !field.sections.includes("experiment") && "experiments",
  ].filter(Boolean);
  return missing.length
    ? {
        ok: false,
        message: `"${field.name}" doesn't apply to ${missing.join(" or ")}, so their changes have no service.`,
      }
    : {
        ok: true,
        message: `"${field.name}" applies to Feature Flags and experiments.`,
      };
}

// "In scope" is what the webhook's Project and tag filters cover, not archived.
function ServiceCoverageCheck({
  eventWebHook,
  serviceField,
}: {
  eventWebHook: EventWebHookInterface;
  serviceField: string;
}) {
  const { features, loading } = useFeatureMetaInfo({
    customFields: [serviceField],
  });
  if (loading) return null;

  const { projects, tags } = eventWebHook;
  const inScope = features.filter(
    (f) =>
      !f.archived &&
      (!projects.length ||
        f.targetingAllProjects ||
        [f.project, ...(f.targetingProjects ?? [])].some(
          (p) => !!p && projects.includes(p),
        )) &&
      (!tags.length || (f.tags ?? []).some((t) => tags.includes(t))),
  );
  const withoutService = inScope.filter(
    (f) => !getDatadogServiceNames([f.customFields?.[serviceField]]).length,
  ).length;

  return withoutService ? (
    <CheckRow
      ok={false}
      message={`${withoutService} of ${inScope.length} Feature Flags in scope have no Datadog service. Their changes reach Event Explorer but no service page.`}
    />
  ) : (
    <CheckRow ok message="Every Feature Flag in scope has a Datadog service." />
  );
}

export default function DatadogWebhookChecks({
  eventWebHook,
  logs,
}: {
  eventWebHook: EventWebHookInterface;
  logs: EventWebHookLogInterface[];
}) {
  const secretsCheck = useSecretsCheck(eventWebHook);
  const serviceFieldCheck = useServiceFieldCheck(
    eventWebHook.datadog?.serviceField,
  );

  const site = datadogSiteForUrl(eventWebHook.url);
  const lastDelivery = logs[0];
  const authFailed =
    lastDelivery?.result === "error" &&
    (lastDelivery.responseCode === 401 || lastDelivery.responseCode === 403);

  const serviceField = eventWebHook.datadog?.serviceField;

  return (
    <Box className="card mt-3 p-4">
      <Flex direction="column" gap="2">
        <CheckRow {...secretsCheck} />
        <CheckRow {...serviceFieldCheck} />
        {serviceField && (
          <ServiceCoverageCheck
            eventWebHook={eventWebHook}
            serviceField={serviceField}
          />
        )}
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
