import { FeatureInterface } from "shared/types/feature";
import { useMemo } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useForm } from "react-hook-form";
import Modal from "@/components/Modal";
import { useExperiments } from "@/hooks/useExperiments";
import Callout from "@/ui/Callout";
import SelectField from "@/components/Forms/SelectField";
import { useAuth } from "@/services/auth";
import { parseDefaultValue } from "@/services/features";

export default function HoldoutModal({
  feature,
  close,
  mutate,
  project,
}: {
  feature: FeatureInterface;
  close: () => void;
  mutate: () => void;
  project: string;
}) {
  const { holdouts, experimentsMap } = useExperiments(
    project,
    false,
    "holdout",
  );
  const { apiCall } = useAuth();

  const holdoutsWithExperiment = useMemo(() => {
    return holdouts.map((holdout) => ({
      ...holdout,
      experiment: experimentsMap.get(
        holdout.experimentId,
      ) as ExperimentInterfaceStringDates,
    }));
  }, [holdouts, experimentsMap]);

  const form = useForm({ defaultValues: { holdout: feature.holdout } });

  return (
    <Modal
      header="Add Feature to Holdout"
      open={true}
      trackingEventModalType="holdout-modal"
      close={close}
      submit={form.handleSubmit(async (values) => {
        const body = {
          holdout: {
            ...values.holdout,
            value: parseDefaultValue(feature.defaultValue, feature.valueType),
          },
        };

        await apiCall<{ feature: FeatureInterface }>(`/feature`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        mutate();
        close();
      })}
    >
      <Callout status="warning">
        Adding this feature to a holdout with existing rules may revert some
        users to receiving the holdout value.
      </Callout>

      {holdoutsWithExperiment.length > 0 && (
        <SelectField
          label="Holdout"
          labelClassName="font-weight-bold"
          value={form.watch("holdout.id") ?? ""}
          onChange={(v) => form.setValue("holdout", { id: v, value: "" })}
          required
          options={holdouts?.map((h) => {
            return {
              label: h.name,
              value: h.id,
            };
          })}
          formatOptionLabel={({ label, value }) => {
            const userIdType = holdoutsWithExperiment?.find(
              (h) => h.id === value,
            )?.experiment.exposureQueryId;
            return (
              <>
                {label}
                {userIdType ? (
                  <span
                    className="text-muted small float-right position-relative"
                    style={{ top: 3 }}
                  >
                    Identifier Type: <code>{userIdType}</code>
                  </span>
                ) : null}
              </>
            );
          }}
        />
      )}
    </Modal>
  );
}
