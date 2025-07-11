import { HoldoutInterface } from "back-end/src/routers/holdout/holdout.validators";
import { useForm } from "react-hook-form";
import { useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import EnvironmentSelect from "../Features/FeatureModal/EnvironmentSelect";
import Modal from "../Modal";
import { genEnvironmentSettings } from "./NewHoldoutForm";

const EditEnvironmentsModal = ({
  holdout,
  handleCloseModal,
  mutate,
}: {
  holdout: HoldoutInterface;
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
      body: JSON.stringify({ holdout: rawValue }),
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
