import { FC, useContext } from "react";
import useForm from "../../hooks/useForm";
import { useAuth } from "../../services/auth";
import {
  ExperimentInterfaceStringDates,
  ImplementationType,
} from "back-end/types/experiment";
import RadioSelector from "../Forms/RadioSelector";
import Modal from "../Modal";
import { UserContext } from "../ProtectedPage";

const ImplementationTypeModal: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const { apiCall } = useAuth();

  const [value, inputProps, manualUpdate] = useForm<
    Partial<ExperimentInterfaceStringDates>
  >({
    autoAssign: true,
    implementation: experiment.implementation || "code",
    previewURL: experiment.previewURL || "",
    targetURLRegex: experiment.targetURLRegex || "",
  });

  const { settings } = useContext(UserContext);

  const implementationTypes = settings.implementationTypes || [];

  return (
    <Modal
      header={"Edit Implementation Type"}
      open={true}
      close={cancel}
      submit={async () => {
        const data = {
          ...value,
        };
        if (value.implementation === "visual" && !value.targetURLRegex) {
          data.targetURLRegex = value.previewURL;
        }

        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(data),
        });
        mutate();
      }}
      cta="Save"
    >
      <div className="form-group">
        <RadioSelector
          name="implementation"
          labelWidth={140}
          value={value.implementation}
          setValue={(value) =>
            manualUpdate({ implementation: value as ImplementationType })
          }
          options={[
            {
              key: "visual",
              display: "Visual Designer",
              description:
                "Test simple copy/color/style changes on your site without writing code",
              enabled: implementationTypes.includes("visual"),
            },
            {
              key: "code",
              display: "Code",
              description:
                "Use our Browser, NodeJS, PHP, or Ruby SDK to code the variations",
              enabled: implementationTypes.includes("code"),
            },
            {
              key: "configuration",
              display: "Feature Flags",
              description:
                "A/B test feature flags or configuration values of your web app",
              enabled: implementationTypes.includes("configuration"),
            },
            {
              key: "custom",
              display: "Custom",
              description:
                "Only use us to document experiments and analyze results",
              enabled: implementationTypes.includes("custom"),
            },
          ]}
        />
      </div>
      {value.implementation === "visual" && (
        <>
          <div className="form-group">
            <label>Visual Designer URL</label>
            <input
              className="form-control"
              type="url"
              required
              placeholder="https://"
              {...inputProps.previewURL}
            />
            <small className="text-muted form-text">
              The specific URL you want to use for the visual editor.
            </small>
          </div>
          <div className="form-group">
            <label>URL Targeting</label>
            <input
              type="text"
              className="form-control"
              placeholder={value.previewURL}
              {...inputProps.targetURLRegex}
            />
            <small className="form-text text-muted">
              A URL regex pattern to target for the experiment. Leave blank to
              use the Visual Designer URL.
            </small>
          </div>
        </>
      )}
    </Modal>
  );
};

export default ImplementationTypeModal;
