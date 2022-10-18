import { FC, useState } from "react";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import track from "../../services/track";
import Field from "../Forms/Field";
import { useEnvironments } from "../../services/features";
import Tooltip from "../Tooltip";
import Toggle from "../Forms/Toggle";

const ApiKeysModal: FC<{
  close: () => void;
  onCreate: () => void;
  defaultDescription?: string;
  secret?: boolean;
}> = ({ close, onCreate, defaultDescription = "", secret = false }) => {
  const { apiCall } = useAuth();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const environments = useEnvironments();

  const form = useForm({
    defaultValues: {
      description: defaultDescription,
      environment: environments[0]?.id || "dev",
      encryptSDK: false,
    },
  });

  const onSubmit = form.handleSubmit(async (value) => {
    if (!secret && !value.description) {
      value.description = value.environment;
    }

    await apiCall("/keys", {
      method: "POST",
      body: JSON.stringify({
        ...value,
        secret,
      }),
    });
    track("Create API Key", {
      environment: value.environment,
      isSecret: secret,
    });
    onCreate();
  });

  return (
    <Modal
      close={close}
      header={secret ? "Create Secret Key" : "Create SDK Endpoint"}
      open={true}
      submit={onSubmit}
      cta="Create"
    >
      {!secret && (
        <Field
          label="Environment"
          options={environments.map((e) => {
            return {
              value: e.id,
              display: e.id,
            };
          })}
          {...form.register("environment")}
        />
      )}
      <Field
        label="Description"
        required={secret}
        placeholder={secret ? "" : form.watch("environment")}
        {...form.register("description")}
      />
      {!secret && showAdvanced && (
        <div className="mb-3 d-flex flex-column">
          <span>
            <label htmlFor="encryptFeatures">
              Encrypt feature list in API response? (optional)
            </label>
            <Tooltip
              className="pl-1"
              body="When enabled this will encrypt the list of features returned from the GrowthBook API. As a result, you will need to decrypt the response before consuming the feature list. "
              tipMinWidth="200px"
            />
          </span>
          <Toggle
            id={"encryptSDK"}
            value={!!form.watch("encryptSDK")}
            setValue={(value) => {
              form.setValue("encryptSDK", value);
            }}
          />
        </div>
      )}
      {!secret && !showAdvanced && (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setShowAdvanced(true);
          }}
        >
          Show advanced settings
        </a>
      )}
    </Modal>
  );
};

export default ApiKeysModal;
