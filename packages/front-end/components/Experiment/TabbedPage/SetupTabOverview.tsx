import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import React, { useState } from "react";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import Collapsible from "react-collapsible";
import { FaAngleRight } from "react-icons/fa";
import { Box, Flex } from "@radix-ui/themes";
import { PreLaunchChecklist } from "@/components/Experiment/PreLaunchChecklist";
import CustomFieldDisplay from "@/components/CustomFields/CustomFieldDisplay";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Markdown from "@/components/Markdown/Markdown";
import EditHypothesisModal from "../EditHypothesisModal";
import EditDescriptionModal from "../EditDescriptionModal";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  mutate: () => void;
  editTargeting?: (() => void) | null;
  linkedFeatures: LinkedFeatureInfo[];
  verifiedConnections: SDKConnectionInterface[];
  disableEditing?: boolean;
  checklistItemsRemaining: number | null;
  setChecklistItemsRemaining: (value: number | null) => void;
}

export default function SetupTabOverview({
  experiment,
  visualChangesets,
  mutate,
  editTargeting,
  linkedFeatures,
  verifiedConnections,
  disableEditing,
  checklistItemsRemaining,
  setChecklistItemsRemaining,
}: Props) {
  const [showHypothesisModal, setShowHypothesisModal] = useState(false);
  const [showDescriptionModal, setShowDescriptionModal] = useState(false);

  const permissionsUtil = usePermissionsUtil();

  const canEditExperiment =
    !experiment.archived &&
    permissionsUtil.canViewExperimentModal(experiment.project) &&
    !disableEditing;

  const isBandit = experiment.type === "multi-armed-bandit";

  return (
    <>
      {showHypothesisModal ? (
        <EditHypothesisModal
          source="experiment-setup-tab"
          mutate={mutate}
          experimentId={experiment.id}
          initialValue={experiment.hypothesis}
          close={() => setShowHypothesisModal(false)}
        />
      ) : null}
      {showDescriptionModal ? (
        <EditDescriptionModal
          source="experiment-setup-tab"
          mutate={mutate}
          experimentId={experiment.id}
          initialValue={experiment.description}
          close={() => setShowDescriptionModal(false)}
        />
      ) : null}
      <div>
        <h2>Overview</h2>
        {experiment.status === "draft" ? (
          <PreLaunchChecklist
            experiment={experiment}
            mutateExperiment={mutate}
            linkedFeatures={linkedFeatures}
            visualChangesets={visualChangesets}
            editTargeting={editTargeting}
            verifiedConnections={verifiedConnections}
            checklistItemsRemaining={checklistItemsRemaining}
            setChecklistItemsRemaining={setChecklistItemsRemaining}
          />
        ) : null}
        <Box className="box" py="4">
          <Collapsible
            open={true}
            transitionTime={100}
            trigger={
              <Flex
                align="center"
                justify="between"
                px="5"
                className="text-dark"
              >
                <h4 className="m-0">Description</h4>
                <Flex align="center">
                  {canEditExperiment ? (
                    <button
                      className="btn p-0 link-purple mr-3"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowDescriptionModal(true);
                      }}
                    >
                      Edit
                    </button>
                  ) : null}
                  <FaAngleRight className="chevron" />
                </Flex>
              </Flex>
            }
          >
            <Box as="div" px="5" pt="4">
              {!experiment.description ? (
                <Box as="span" className="font-italic text-muted">
                  Add a description to keep your team informed about the purpose
                  and parameters of your experiment
                </Box>
              ) : (
                <Markdown>{experiment.description}</Markdown>
              )}
            </Box>
          </Collapsible>
        </Box>

        {!isBandit && (
          <div className="box px-4 py-3">
            <div className="d-flex flex-row align-items-center justify-content-between mb-3">
              <h4 className="m-0">Hypothesis</h4>
              <div className="flex-1" />
              {canEditExperiment ? (
                <button
                  className="btn p-0 link-purple"
                  onClick={() => setShowHypothesisModal(true)}
                >
                  <span className="text-purple">Edit</span>
                </button>
              ) : null}
            </div>
            <div>
              {!experiment.hypothesis ? (
                <span className="font-italic text-muted">
                  Add a hypothesis statement to help focus the nature of your
                  experiment
                </span>
              ) : (
                experiment.hypothesis
              )}
            </div>
          </div>
        )}
        <CustomFieldDisplay
          addBox={true}
          target={experiment}
          canEdit={canEditExperiment}
          mutate={mutate}
          section="experiment"
        />
      </div>
    </>
  );
}
