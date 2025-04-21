import { SafeRolloutInterface } from "back-end/src/validators/safe-rollout";
import { SafeRolloutRule } from "back-end/src/validators/features";
import { useForm } from "react-hook-form";
import { PutFeatureRuleBody } from "back-end/types/feature-rule";
import { Text } from "@radix-ui/themes";
import {
  getHealthSettings,
  getSafeRolloutDaysLeft,
  getSafeRolloutResultStatus,
} from "shared/enterprise";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import RadioGroup from "@/components/Radix/RadioGroup";
import { useUser } from "@/services/UserContext";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";

type Status = Pick<SafeRolloutRule, "status">;
type StatusValues = Status["status"];
export interface Props {
  safeRollout: SafeRolloutInterface;
  rule: SafeRolloutRule;
  open: boolean;
  setStatusModalOpen: (open: boolean) => void;
  setVersion: (version: number) => void;
  environment: string;
  version: number;
  i: number;
  featureId: string;
  defaultStatus: StatusValues;
  mutate?: () => void;
}

export default function SafeRolloutStatusModal({
  safeRollout,
  rule,
  open,
  setStatusModalOpen,
  setVersion,
  environment,
  version,
  i,
  featureId,
  defaultStatus,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  defaultStatus = defaultStatus || safeRollout.status;
  const { snapshot: snapshotWithResults } = useSafeRolloutSnapshot();

  const { hasCommercialFeature, organization } = useUser();
  const settings = organization?.settings;

  const daysLeft = getSafeRolloutDaysLeft({
    safeRollout,
    snapshotWithResults,
  });

  const decisionStatus = getSafeRolloutResultStatus({
    safeRollout,
    healthSettings: getHealthSettings(
      settings,
      hasCommercialFeature("decision-framework")
    ),
    daysLeft,
  });
  let titleCopy = "Rollout is still collecting data";
  if (decisionStatus?.status === "unhealthy") {
    titleCopy =
      "Rollout is Marked as unhealthy. you might want to revert to control";
    defaultStatus = "rolled-back";
  }
  if (decisionStatus?.status === "no-data") {
    titleCopy = "Rollout is not collecting data";
    defaultStatus = "rolled-back";
  }
  if (decisionStatus?.status === "ship-now") {
    titleCopy = "Rollout is ready to be released 100% to Variation";
    defaultStatus = "released";
  }

  const form = useForm<Status>({
    defaultValues: {
      status: defaultStatus,
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const res = await apiCall<{ version: number }>(
      `/feature/${featureId}/${version}/rule`,
      {
        method: "PUT",
        body: JSON.stringify({
          rule: values,
          environment,
          safeRolloutFields: values,
          i,
        } as PutFeatureRuleBody),
      }
    );
    setVersion(res.version);
    setStatusModalOpen(false);
    mutate?.();
  });
  return (
    <Modal
      open={open}
      close={() => setStatusModalOpen(false)}
      header={`End Safe Rollout`}
      submit={() => onSubmit()}
      size="lg"
      bodyClassName="px-4 pt-4"
      trackingEventModalType={"updateSafeRolloutStatus"}
      allowlistedTrackingEventProps={{
        status: form.watch("status"),
      }}
    >
      <Text as="div" size="2" mb="3">
        {titleCopy}
      </Text>
      <div>
        <Text as="div" size="3" mb="2" weight="medium">
          {" "}
          Update SafeRollout Status
        </Text>
        <RadioGroup
          value={form.watch("status")}
          setValue={(v: "rolled-back" | "released") => {
            form.setValue("status", v);
          }}
          options={[
            {
              value: "rolled-back",
              label: `Revert to ${rule.controlValue}`,
            },
            {
              value: "released",
              label: `Rollout to ${rule.variationValue}`,
            },
          ]}
        />
      </div>
    </Modal>
  );
}
