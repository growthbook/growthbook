import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import { LinkedFeatureInfo } from "shared/types/experiment";
import { getReviewSetting } from "shared/util";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import {
  describeWaitingReason,
  getQaOverrideWaitingFeatures,
  QaOverrideWaitingFeature,
} from "./QaOverrideSummary";

// Lists each linked feature that won't serve the override in `environment`
// yet, with the quickest way to fix it: turning the flag on in that
// environment (published directly when no approval is required, otherwise
// staged as a draft to approve), or a link to the feature for rule changes.
export default function QaOverrideFeatureGate({
  environment,
  linkedFeatures,
  onChanged,
}: {
  environment: string;
  linkedFeatures: LinkedFeatureInfo[] | undefined;
  onChanged?: () => Promise<unknown> | void;
}) {
  const waiting = getQaOverrideWaitingFeatures({ environment }, linkedFeatures);
  if (!waiting.length) return null;
  return (
    <Flex direction="column" gap="2">
      {waiting.map((w) => {
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
  const canToggleEnv = waiting.reason === "disabled-env";

  // Same gate the kill-switch modal applies: an environment toggle can be
  // published directly unless this environment requires review (and the user
  // can't bypass it).
  const rawRequireReviews = settings?.requireReviews;
  const reviewSetting = Array.isArray(rawRequireReviews)
    ? getReviewSetting(rawRequireReviews, feature)
    : null;
  const envIsGated = (() => {
    if (rawRequireReviews === true) return true;
    if (!reviewSetting?.requireReviewOn) return false;
    if (reviewSetting.featureRequireEnvironmentReview === false) return false;
    const gated = reviewSetting.environments ?? [];
    return gated.length === 0 || gated.includes(environment);
  })();
  const canBypass = permissionsUtil.canBypassFlagApprovalChecks(
    feature,
    "feature",
  );
  const canPublish =
    (canBypass || !envIsGated) &&
    permissionsUtil.canPublishFeature(feature, [environment]);
  const canDraft = permissionsUtil.canEditFeatureDrafts(feature);

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
        : {describeWaitingReason(waiting.reason)}
      </Text>
      {stagedVersion !== null ? (
        <Text size="sm" color="text-mid">
          Draft staged.{" "}
          <Link href={`${featureHref}?v=${stagedVersion}`}>
            Review and publish it
          </Link>{" "}
          to activate this override.
        </Text>
      ) : canToggleEnv && canPublish ? (
        <Button variant="soft" size="sm" onClick={() => toggle(true)}>
          Enable in {environment}
        </Button>
      ) : canToggleEnv && canDraft ? (
        <Button variant="soft" size="sm" onClick={() => toggle(false)}>
          Stage draft for approval
        </Button>
      ) : (
        <Link href={featureHref}>Open feature</Link>
      )}
      {error && <Callout status="error">{error}</Callout>}
    </Flex>
  );
}
