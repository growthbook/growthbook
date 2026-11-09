import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import { LinkedFeatureInfo } from "shared/types/experiment";
import { QaOverrideWaitingFeature } from "shared/types/experiment-qa-override";
import { canPublishEnvironmentToggle } from "shared/permissions";
import { QA_OVERRIDE_WAITING_REASONS } from "shared/util";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

// Each linked Feature Flag that won't serve the override in `environment` yet,
// with the quickest fix: turning the flag on there (published directly when no
// approval is required, otherwise staged as a draft to approve), or a link to
// the Feature Flag for rule changes.
export default function QaOverrideFeatureGate({
  environment,
  waitingOn,
  linkedFeatures,
  onChanged,
}: {
  environment: string;
  waitingOn: QaOverrideWaitingFeature[];
  linkedFeatures: LinkedFeatureInfo[] | undefined;
  onChanged?: () => Promise<unknown> | void;
}) {
  if (!waitingOn.length) return null;
  return (
    <Flex direction="column" gap="2">
      {waitingOn.map((w) => {
        const info = linkedFeatures?.find((f) => f.feature.id === w.featureId);
        if (!info) return null;
        return (
          <WaitingFeatureRow
            key={w.featureId}
            feature={info.feature}
            waiting={w}
            environment={environment}
            onChanged={onChanged}
          />
        );
      })}
    </Flex>
  );
}

function WaitingFeatureRow({
  feature,
  waiting,
  environment,
  onChanged,
}: {
  feature: FeatureInterface;
  waiting: QaOverrideWaitingFeature;
  environment: string;
  onChanged?: () => Promise<unknown> | void;
}) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const settings = useOrgSettings();
  const [stagedVersion, setStagedVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const featureHref = `/features/${feature.id}`;
  // Only a flag that's off can be fixed with a toggle; rule problems need
  // the Feature Flag page.
  const path =
    waiting.reason === "disabled-env"
      ? canPublishEnvironmentToggle(
          permissionsUtil,
          feature,
          environment,
          settings?.requireReviews,
        )
      : "none";

  const toggle = async (autoPublish: boolean) => {
    setError(null);
    try {
      const res = await apiCall<{ status: 200; draftVersion?: number }>(
        `/feature/${feature.id}/toggle`,
        {
          method: "POST",
          body: JSON.stringify({
            environments: { [environment]: true },
            ...(autoPublish ? { autoPublish: true } : {}),
          }),
        },
      );
      if (!autoPublish && res.draftVersion) setStagedVersion(res.draftVersion);
      await onChanged?.();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Flex align="center" gap="3" wrap="wrap">
      <Text size="sm" color="text-mid">
        <Link href={featureHref}>
          <code>{feature.id}</code>
        </Link>
        : {QA_OVERRIDE_WAITING_REASONS[waiting.reason]}
      </Text>
      {stagedVersion !== null ? (
        <Text size="sm" color="text-mid">
          Draft staged.{" "}
          <Link href={`${featureHref}?v=${stagedVersion}`}>
            Review and publish it
          </Link>{" "}
          to activate this override.
        </Text>
      ) : path === "publish" ? (
        <Button variant="soft" size="sm" onClick={() => toggle(true)}>
          Enable in {environment}
        </Button>
      ) : path === "draft" ? (
        <Button variant="soft" size="sm" onClick={() => toggle(false)}>
          Stage draft for approval
        </Button>
      ) : (
        <Link href={featureHref}>Open Feature Flag</Link>
      )}
      {error && <Callout status="error">{error}</Callout>}
    </Flex>
  );
}
