import React, { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { FaRegCircleCheck } from "react-icons/fa6";
import { ExperimentInterfaceStringDates } from "@back-end/types/experiment";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "@/components/Modal";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import track from "@/services/track";
import NewExperimentForm from "./NewExperimentForm";
import ImportExperimentModal from "./ImportExperimentModal";
type ModalType = "new" | "import";

const AddExperimentModal: FC<{
  onClose: () => void;
  source: string;
  type?: ModalType;
  initialValue?: Partial<ExperimentInterfaceStringDates>;
}> = ({
  onClose,
  source,
  type = null,
  initialValue = { type: "standard" },
}) => {
  const { project } = useDefinitions();

  const permissionsUtil = usePermissionsUtil();
  const hasCreateExperimentsPermission = permissionsUtil.canCreateExperiment({
    project,
  });

  const [modalType, setModalType] = useState<ModalType | null>(type);

  const form = useForm<{
    mode: "new" | "import" | "";
  }>({
    defaultValues: {
      mode: "",
    },
  });

  switch (modalType) {
    case "new":
      return (
        <NewExperimentForm
          onClose={onClose}
          source={source}
          isNewExperiment={true}
          initialValue={initialValue}
        />
      );
    case "import":
      return <ImportExperimentModal onClose={onClose} source={source} />;
    default:
      return (
        <Modal
          trackingEventModalType=""
          open
          close={onClose}
          autoCloseOnSubmit={false}
          submit={() => {
            if (modalType) return;
            const data = form.getValues();
            const mode = data.mode;
            if (!mode) {
              throw new Error(
                `Select "Create New Experiment" or "Analyze Existing Experiment"`
              );
            }
            setModalType(mode);
            track(
              mode === "new"
                ? "Design a New Experiment"
                : "Analyze an Existing Experiment",
              { source }
            );
          }}
          cta="Next >"
          ctaEnabled={!!form.watch("mode")}
          size="lg"
          header="Add Experiment"
        >
          <div className="mx-2">
            <div className="bg-highlight rounded py-4 px-4 mb-4">
              <ButtonSelectField
                buttonType="card"
                value={form.watch("mode")}
                setValue={(v) => form.setValue("mode", v)}
                options={[
                  {
                    label: (
                      <div
                        className="mx-3 d-flex flex-column align-items-center justify-content-center"
                        style={{ minHeight: 120 }}
                      >
                        <div className="h4">
                          {form.watch("mode") === "new" && (
                            <FaRegCircleCheck
                              size={18}
                              className="check text-success mr-2"
                            />
                          )}
                          Create New Experiment
                        </div>
                        <div className="small">
                          Run a new experiment using Feature Flags, our Visual
                          Editor, or URL Redirects.
                        </div>
                      </div>
                    ),
                    value: "new",
                    disabled: !hasCreateExperimentsPermission,
                  },
                  {
                    label: (
                      <div
                        className="mx-3 d-flex flex-column align-items-center justify-content-center"
                        style={{ minHeight: 120 }}
                      >
                        <div className="h4">
                          {form.watch("mode") === "import" && (
                            <FaRegCircleCheck
                              size={18}
                              className="check text-success mr-2"
                            />
                          )}
                          Analyze Existing Experiment
                        </div>
                        <div className="small">
                          Import currently running, stopped, or archived
                          experiments to analyze results.
                        </div>
                      </div>
                    ),
                    value: "import",
                  },
                ]}
              />
            </div>
          </div>
        </Modal>
      );
  }
};

export default AddExperimentModal;
