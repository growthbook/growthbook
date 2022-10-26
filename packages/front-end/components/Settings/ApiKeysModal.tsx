import { FC, useState } from "react";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import track from "../../services/track";
import Field from "../Forms/Field";
import { useEnvironments } from "../../services/features";
import Toggle from "../Forms/Toggle";
import { DocLink } from "../DocLink";

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
        <div>
          <div className="mb-2 d-flex flex-column">
            <span>
              <label htmlFor="encryptFeatures">
                Encrypt features in the SDK Endpoint?
              </label>
            </span>
            <Toggle
              id={"encryptSDK"}
              value={!!form.watch("encryptSDK")}
              setValue={(value) => {
                form.setValue("encryptSDK", value);
              }}
            />
          </div>
          <div className="alert alert-warning">
            When enabled, you will need to decrypt features before passing into
            our SDKs.{" "}
            <DocLink docSection="encryptedSDKEndpoints">View docs</DocLink> for
            more info and sample code.
          </div>
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
