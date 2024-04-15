import { useForm } from "react-hook-form";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Field from "@/components/Forms/Field";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";

export type Props = {
  close?: () => void;
  onSuccess: (calculation: unknown) => Promise<void>;
};

interface PowerCalculationParams {
  metrics: string[];
  usersPerDay?: number;
}

export default function PowerCalculationModal({ close, onSuccess }: Props) {
  const { metrics } = useDefinitions();

  const form = useForm<PowerCalculationParams>({
    defaultValues: {
      metrics: [],
    },
  });

  const usersPerDay = form.watch("usersPerDay");
  const isUsersPerDayInvalid = usersPerDay !== undefined && usersPerDay <= 0;

  return (
    <Modal
      open
      size="lg"
      header="New Calculation"
      close={close}
      includeCloseCta={false}
      cta="Next >"
      secondaryCTA={<button className="btn btn-primary">Next &gt;</button>}
    >
      <MultiSelectField
        labelClassName="d-flex"
        label={
          <>
            <span className="mr-auto font-weight-bold">Select Metrics</span>{" "}
            Limit 5
          </>
        }
        sort={false}
        value={form.watch("metrics")}
        options={metrics.map(({ name: label, id: value }) => ({
          label,
          value,
        }))}
        onChange={(value: string[]) => {
          form.setValue("metrics", value);
        }}
      />

      <Field
        label={
          <div>
            <span className="font-weight-bold mr-1">Estimated users per day</span>
            <Tooltip
              popperClassName="text-left"
              body="Total users accross all variations"
              tipPosition="right"
            />
          </div>
        }
        type="number"
        {...form.register("usersPerDay", {
          valueAsNumber: true,
        })}
        className={isUsersPerDayInvalid ? "border border-danger" : undefined}
        helpText={
          isUsersPerDayInvalid ? (
            <div className="text-danger">Must be greater than 0</div>
          ) : undefined
        }
      />
    </Modal>
  );
}
