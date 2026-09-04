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
import { IMPLEMENTATION_TYPE_OPTIONS } from "@/components/Experiment/ImplementationTypeSelect";

// Only reachable while nothing else is wired up: a managed flag is the one
// implementation this flow removes itself (or ejects, when moving to Feature Flag).
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
  // The managed marker outranks a derived type on experiments adopted before
  // the type was stored.
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

  return (
    <ModalStandard
      open={true}
      close={close}
      trackingEventModalType="change-implementation-type"
      header="Change Experiment Type"
      cta="Change Type"
      ctaEnabled={changed && (!removesManagedFlag || acknowledged)}
      submit={async () => {
        if (!next) return;
        if (ejectsManagedFlag) {
          await apiCall(`/experiment/${experiment.id}/managed-flag/eject`, {
            method: "POST",
          });
        } else if (removesManagedFlag) {
          await apiCall(`/experiment/${experiment.id}/managed-flag/remove`, {
            method: "POST",
          });
        }
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
      {ejectsManagedFlag && (
        <Callout status="info" mt="3">
          <code>{managedKey}</code> becomes an ordinary linked Feature Flag,
          edited from its own page.
        </Callout>
      )}
      {removesManagedFlag && (
        <Callout status="warning" mt="3">
          <Text as="p" mb="2">
            This deletes the managed Feature Flag <code>{managedKey}</code> and
            its pending values.
          </Text>
          <Checkbox
            label="Delete the Feature Flag"
            value={acknowledged}
            setValue={(v) => setAcknowledged(!!v)}
          />
        </Callout>
      )}
    </ModalStandard>
  );
}
