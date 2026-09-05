import { useState } from "react";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ImplementationType } from "shared/validators";
import {
  getImplementationType,
  SELECTABLE_IMPLEMENTATION_TYPES,
} from "shared/util";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RadioCards from "@/ui/RadioCards";
import Avatar from "@/ui/Avatar";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import { IMPLEMENTATION_TYPE_OPTIONS } from "@/components/Experiment/ImplementationTypeSelect";

export default function ChangeImplementationTypeModal({
  experiment,
  managedFeature,
  close,
  mutate,
}: {
  experiment: ExperimentInterfaceStringDates;
  managedFeature: LinkedFeatureInfo | null;
  close: () => void;
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const allEnvironments = useEnvironments();
  // Experiments adopted before the type was stored only carry the flag's marker.
  const current = managedFeature ? "values" : getImplementationType(experiment);
  const [next, setNext] = useState<ImplementationType | "">(
    current && SELECTABLE_IMPLEMENTATION_TYPES.includes(current) ? current : "",
  );
  const [acknowledged, setAcknowledged] = useState(false);

  const changed = !!next && next !== current;
  const ejectsManagedFlag = !!managedFeature && changed && next === "feature";
  const removesManagedFlag =
    !!managedFeature && changed && next !== "feature" && next !== "values";
  const managedKey = managedFeature?.feature.id;
  const managedEnvs = managedFeature
    ? getEnabledEnvironments(managedFeature.feature, allEnvironments)
    : [];
  // The server takes publish authority to convert and delete authority to remove.
  const blockedReason =
    ejectsManagedFlag &&
    managedFeature &&
    !permissionsUtil.canPublishFeature(managedFeature.feature, managedEnvs)
      ? "Converting the Feature Flag requires permission to publish it."
      : removesManagedFlag &&
          managedFeature &&
          !permissionsUtil.canDeleteFeature(managedFeature.feature, managedEnvs)
        ? "Removing the Feature Flag requires permission to delete it."
        : null;

  return (
    <ModalStandard
      open={true}
      close={close}
      trackingEventModalType="change-implementation-type"
      header="Change Implementation Type"
      cta="Change Type"
      ctaEnabled={
        changed && !blockedReason && (!removesManagedFlag || acknowledged)
      }
      submit={async () => {
        if (!next) return;
        // The server converts or deletes the managed flag as part of the change.
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({ implementationType: next }),
        });
        mutate();
      }}
    >
      <Text as="p" color="text-mid" mb="3">
        Choose how this experiment delivers its variations.
      </Text>
      <RadioCards
        width="100%"
        value={next}
        setValue={(v) => {
          setNext(v as ImplementationType);
          setAcknowledged(false);
        }}
        labelSize="md"
        descriptionSize="sm"
        options={SELECTABLE_IMPLEMENTATION_TYPES.map((type) => {
          const option = IMPLEMENTATION_TYPE_OPTIONS[type];
          return {
            value: type,
            label: option.header,
            description: option.description,
            avatar: (
              <Avatar
                radius="small"
                color={option.color}
                size="sm"
                variant="soft"
              >
                {option.icon}
              </Avatar>
            ),
            badge: type === current ? "Current" : undefined,
          };
        })}
      />
      {blockedReason && (
        <Callout status="error" mt="3">
          {blockedReason}
        </Callout>
      )}
      {ejectsManagedFlag && !blockedReason && (
        <Callout status="info" mt="3">
          <code>{managedKey}</code> becomes an ordinary linked Feature Flag,
          edited from its own page.
        </Callout>
      )}
      {removesManagedFlag && !blockedReason && (
        <Callout status="warning" mt="3">
          <Text as="p" mb="3">
            This deletes the managed Feature Flag <code>{managedKey}</code> and
            its pending values.
          </Text>
          <Checkbox
            label="Delete the Feature Flag"
            weight="regular"
            value={acknowledged}
            setValue={(v) => setAcknowledged(!!v)}
          />
        </Callout>
      )}
    </ModalStandard>
  );
}
