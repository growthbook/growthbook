import React, { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { ExperimentType } from "@back-end/src/validators/experiments";
import { FaRegCircleCheck } from "react-icons/fa6";
import { ExperimentInterfaceStringDates } from "@back-end/types/experiment";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "@/components/Modal";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import RadioSelector from "@/components/Forms/RadioSelector";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import track from "@/services/track";
import NewExperimentForm from "./NewExperimentForm";
import ImportExperimentModal from "./ImportExperimentModal";

const AddExperimentModal: FC<{
  onClose: () => void;
  source: string;
}> = ({ onClose, source }) => {
  const { project } = useDefinitions();
  const { hasCommercialFeature } = useUser();
  const settings = useOrgSettings();

  const permissionsUtil = usePermissionsUtil();
  const hasCreateExperimentsPermission = permissionsUtil.canCreateExperiment({
    project,
  });

  const hasStickyBucketFeature = hasCommercialFeature("sticky-bucketing");
  const hasMultiArmedBanditFeature = hasCommercialFeature(
    "multi-armed-bandits"
  );

  const usingStickyBucketing = !!settings.useStickyBucketing;

  const [modalType, setModalType] = useState<"new" | "import" | null>(null);
  const [initialValue, setInitialValue] = useState<
    Partial<ExperimentInterfaceStringDates>
  >({
    type: "standard",
  });

  const form = useForm<{
    mode: "new" | "import" | "";
    type: ExperimentType;
  }>({
    defaultValues: {
      mode: "",
      type: "standard",
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
          open
          close={onClose}
          autoCloseOnSubmit={false}
          submit={() => {
            if (modalType) return;
            const data = form.getValues();
            const mode = data.mode;
            const type = data.type;
            if (!mode) {
              throw new Error(
                `Select "Create New Experiment" or "Analyze Existing Experiment"`
              );
            }
            if (type === "multi-armed-bandit") {
              setInitialValue({
                type,
                statsEngine: "bayesian",
              });
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
                        {form.watch("mode") === "new" && (
                          <FaRegCircleCheck
                            size={16}
                            className="check text-success mb-2"
                          />
                        )}
                        <div className="h4">Create New Experiment</div>
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
                        {form.watch("mode") === "import" && (
                          <FaRegCircleCheck
                            size={16}
                            className="check text-success mb-2"
                          />
                        )}
                        <div className="h4">Analyze Existing Experiment</div>
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

            {form.watch("mode") === "new" && (
              <div className="form-group mt-3">
                <label className="text-dark">Select Experiment Type</label>
                <RadioSelector
                  name="type"
                  value={form.watch("type")}
                  setValue={(v) => form.setValue("type", v as ExperimentType)}
                  descriptionNewLine={true}
                  options={[
                    {
                      key: "standard",
                      display: (
                        <>
                          <strong className="mr-2">Standard.</strong>
                          <span>
                            Variation weights are constant throughout the
                            experiment.
                          </span>
                        </>
                      ),
                    },
                    {
                      key: "multi-armed-bandit",
                      disabled:
                        !hasMultiArmedBanditFeature || !usingStickyBucketing,
                      display: (
                        <>
                          <PremiumTooltip
                            commercialFeature="multi-armed-bandits"
                            body={
                              !usingStickyBucketing &&
                              hasStickyBucketFeature ? (
                                <div>
                                  Enable Sticky Bucketing in your organization
                                  settings to run a Multi-Armed Bandit
                                  experiment.
                                </div>
                              ) : null
                            }
                          >
                            <strong className="mr-2">
                              Multi-Armed Bandit.
                            </strong>
                          </PremiumTooltip>
                          <span>
                            Variations with better results receive more traffic
                            during the experiment.
                          </span>
                        </>
                      ),
                    },
                  ]}
                />
              </div>
            )}
          </div>
        </Modal>
      );
  }
};

export default AddExperimentModal;
