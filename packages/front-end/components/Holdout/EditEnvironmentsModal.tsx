import { HoldoutInterface } from "back-end/src/routers/holdout/holdout.validators";
import { useForm } from "react-hook-form";
import { Box, Text } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import EnvironmentSelect from "../Features/FeatureModal/EnvironmentSelect";
import Modal from "../Modal";
import { genEnvironmentSettings } from "./NewHoldoutForm";

const EditEnvironmentsModal = ({
  holdout,
  experiment,
  handleCloseModal,
  mutate,
}: {
  holdout: HoldoutInterface;
  experiment: ExperimentInterfaceStringDates;
  handleCloseModal: () => void;
  mutate: () => void;
}) => {
  const environments = useEnvironments();
  const permissionsUtils = usePermissionsUtil();
  const { apiCall } = useAuth();

  const form = useForm<Partial<HoldoutInterface>>({
    defaultValues: {
      environmentSettings:
        holdout.environmentSettings ||
        genEnvironmentSettings({
          environments,
          permissions: permissionsUtils,
          project: "",
        }),
    },
  });

  const onSubmit = form.handleSubmit(async (rawValue) => {
    await apiCall<{
      holdout: HoldoutInterface;
    }>(`/holdout/${holdout.id}`, {
      method: "PUT",
      body: JSON.stringify({
        environmentSettings: rawValue.environmentSettings,
      }),
    });
    mutate();
  });

  const environmentSettings = form.watch("environmentSettings") || {};

  return (
    <Modal
      open={true}
      trackingEventModalType=""
      header="Edit Included Environments"
      close={handleCloseModal}
      submit={onSubmit}
      size="lg"
    >
      <div className="px-2">
        <Box mb="4">
          <Text size="2" style={{ color: "var(--color-text-mid)" }}>
            Review all environment selections before starting a Holdout. Changes
            made while a Holdout is running can render results inconclusive.
          </Text>
        </Box>
        {experiment.status === "running" && (
          <Callout status="warning" mb="4">
            <Text>
              Proceed with caution. Holdout is running. Adding or removing
              environments could impact results.{" "}
            </Text>
          </Callout>
        )}
        <EnvironmentSelect
          environmentSettings={environmentSettings}
          environments={environments}
          setValue={(env, on) => {
            environmentSettings[env.id].enabled = on;
            form.setValue("environmentSettings", environmentSettings);
          }}
        />
      </div>
    </Modal>
  );
};

export default EditEnvironmentsModal;
