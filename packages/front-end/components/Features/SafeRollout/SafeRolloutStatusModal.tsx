import {
  SafeRolloutInterface,
  FeatureInterface,
  FeatureValueType,
  SafeRolloutRule,
} from "shared/validators";
import { useForm } from "react-hook-form";
import { Text } from "@radix-ui/themes";
import {
  getHealthSettings,
  getSafeRolloutDaysLeft,
  getSafeRolloutResultStatus,
} from "shared/enterprise";
import { ExperimentResultStatus } from "shared/types/experiment";
import { useEffect, useMemo } from "react";
import { featureRequiresReview } from "shared/util";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import { useUser } from "@/services/UserContext";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import Callout from "@/ui/Callout";
import SelectField from "@/components/Forms/SelectField";
import ValueDisplay from "@/components/Features/ValueDisplay";

export interface Props {
  safeRollout: SafeRolloutInterface;
  valueType: FeatureValueType;
  rule: SafeRolloutRule;
  open: boolean;
  setStatusModalOpen: (open: boolean) => void;
  setVersion: (version: number) => void;
  environment: string;
  feature: FeatureInterface;
  mutate?: () => void;
}

type RolloutStatusChoice = "rolled-back" | "released" | "";

function getDefaultStatusAndText(
  decisionStatus: ExperimentResultStatus | undefined,
): { defaultStatus: RolloutStatusChoice; text: MessageDescriptor | null } {
  if (!decisionStatus) {
    return {
      defaultStatus: "",
      text: null,
    };
  }

  switch (decisionStatus.status) {
    case "unhealthy":
      return {
        defaultStatus: "rolled-back",
        text: msg`The Safe Rollout is marked as unhealthy. We recommend reverting to Control.`,
      };
    case "ship-now":
      return {
        defaultStatus: "released",
        text: msg`The Safe Rollout has finished and no issues were detected.`,
      };
    case "rollback-now":
      return {
        defaultStatus: "rolled-back",
        text: msg`The Safe Rollout has failing guardrails. We recommend reverting to Control.`,
      };
    case "data-incomplete":
      return {
        defaultStatus: "",
        text: msg`Some guardrail metrics could not be computed, so no ship recommendation is available.`,
      };
    case "before-min-duration":
    case "days-left":
    case "no-data":
      return {
        defaultStatus: "",
        text: msg`The Safe Rollout is still collecting data. Are you sure you want to stop early?`,
      };
    case "ready-for-review":
    case "scheduled-end-review":
      return {
        defaultStatus: "",
        text: msg`The Safe Rollout is ready for review. Are you sure you want to stop early?`,
      };
  }
}

export default function SafeRolloutStatusModal({
  safeRollout,
  valueType,
  rule,
  open,
  setStatusModalOpen,
  setVersion,
  environment,
  feature,
  mutate,
}: Props) {
  const { t, i18n } = useLingui();
  const { apiCall } = useAuth();
  const { snapshot: snapshotWithResults } = useSafeRolloutSnapshot();

  const { hasCommercialFeature, organization } = useUser();

  const settings = organization?.settings;

  const reviewRequired = useMemo(() => {
    return featureRequiresReview(feature, [environment], false, settings);
  }, [feature, environment, settings]);

  const daysLeft = getSafeRolloutDaysLeft({
    safeRollout: safeRollout,
    snapshotWithResults,
  });

  const decisionStatus = getSafeRolloutResultStatus({
    safeRollout: safeRollout,
    healthSettings: getHealthSettings(
      settings,
      hasCommercialFeature("decision-framework"),
    ),
    daysLeft,
  });

  const form = useForm<{ status: RolloutStatusChoice }>({
    defaultValues: {
      status: "",
    },
  });

  const { defaultStatus, text } = getDefaultStatusAndText(decisionStatus);

  const status = form.watch("status");

  const selectedValue =
    status === "released"
      ? rule.variationValue
      : status === "rolled-back"
        ? rule.controlValue
        : null;

  // The default status depends on async API calls, so when that finishes, update the form
  // As long as the user has not interacted with the input yet
  useEffect(() => {
    if (status || !defaultStatus) return;
    form.setValue("status", defaultStatus);
  }, [form, status, defaultStatus]);

  return (
    <Modal
      open={open}
      close={() => setStatusModalOpen(false)}
      header={t`End Safe Rollout`}
      ctaEnabled={!!status}
      submit={form.handleSubmit(async (values) => {
        const res = await apiCall<{ version: number }>(
          `/feature/${feature.id}/safeRollout/status`,
          {
            method: "PUT",
            body: JSON.stringify({
              status: values.status,
              environment,
              ruleId: rule.id,
            }),
          },
        );
        setVersion(res.version);
        mutate?.();
      })}
      size="lg"
      bodyClassName="px-4 pt-4"
      trackingEventModalType={"updateSafeRolloutStatus"}
      allowlistedTrackingEventProps={{ status }}
    >
      {text ? (
        <Text as="div" size="2" mb="4">
          {i18n._(text)}
        </Text>
      ) : null}
      <div className="mb-4">
        <SelectField
          size="legacy"
          label={t`Update Safe Rollout status`}
          value={form.watch("status")}
          required
          onChange={(v: "rolled-back" | "released") => {
            form.setValue("status", v);
          }}
          options={[
            {
              value: "rolled-back",
              label: t`Revert to 'Control'`,
            },
            {
              value: "released",
              label: t`Release to 100%`,
            },
          ]}
          sort={false}
        />
      </div>
      {status && selectedValue !== null ? (
        <div className="form-group mb-4">
          <label>
            <Trans>Value to roll out</Trans>
          </label>
          <div>
            <ValueDisplay type={valueType} value={selectedValue} />
          </div>
        </div>
      ) : null}
      <Callout status="info" my="4">
        {reviewRequired
          ? t`A new draft will be created and the safe rollout will continue running until the draft is reviewed and published.`
          : t`A new revision will be published and changes will take effect immediately.`}
      </Callout>
    </Modal>
  );
}
