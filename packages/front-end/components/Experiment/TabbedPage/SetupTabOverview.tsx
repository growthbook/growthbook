import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import React, { useState } from "react";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import Collapsible from "react-collapsible";
import { FaAngleRight } from "react-icons/fa";
import { Box, Flex, ScrollArea, Heading } from "@radix-ui/themes";
import { PreLaunchChecklist } from "@/components/Experiment/PreLaunchChecklist";
import CustomFieldDisplay from "@/components/CustomFields/CustomFieldDisplay";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Markdown from "@/components/Markdown/Markdown";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Frame from "@/components/Radix/Frame";
import Button from "@/components/Radix/Button";
import EditHypothesisModal from "../EditHypothesisModal";
import EditDescriptionModal from "../EditDescriptionModal";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  mutate: () => void;
  editTargeting?: (() => void) | null;
  linkedFeatures: LinkedFeatureInfo[];
  matchingConnections: SDKConnectionInterface[];
  disableEditing?: boolean;
  checklistItemsRemaining: number | null;
  setChecklistItemsRemaining: (value: number | null) => void;
  envs: string[];
}

export default function SetupTabOverview({
  experiment,
  visualChangesets,
  mutate,
  editTargeting,
  linkedFeatures,
  matchingConnections,
  disableEditing,
  checklistItemsRemaining,
  setChecklistItemsRemaining,
  envs,
}: Props) {
  const [showHypothesisModal, setShowHypothesisModal] = useState(false);
  const [showDescriptionModal, setShowDescriptionModal] = useState(false);
  const [expandDescription, setExpandDescription] = useLocalStorage(
    `collapse-${experiment.id}-description`,
    localStorage.getItem(`collapse-${experiment.id}-description`) === "true"
      ? false
      : true
  );

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
            envs={envs}
            mutateExperiment={mutate}
            linkedFeatures={linkedFeatures}
            visualChangesets={visualChangesets}
            editTargeting={editTargeting}
            connections={matchingConnections}
            checklistItemsRemaining={checklistItemsRemaining}
            setChecklistItemsRemaining={setChecklistItemsRemaining}
          />
        ) : null}
        <Frame>
          <Collapsible
            open={!experiment.description ? true : expandDescription}
            transitionTime={100}
            triggerDisabled={!experiment.description}
            onOpening={() => setExpandDescription(true)}
            onClosing={() => setExpandDescription(false)}
            trigger={
              <Box
                as="div"
                style={{
                  cursor: `${experiment.description ? "pointer" : "default"}`,
                }}
              >
                <Flex align="center" justify="between" className="text-dark">
                  <Heading mb="0" as="h4" size="3">
                    Description
                  </Heading>
                  <Flex align="center" gap="2">
                    {canEditExperiment ? (
                      <Button
                        variant="ghost"
                        stopPropagation={true}
                        mr={experiment.description ? "3" : "0"}
                        onClick={() => {
                          setShowDescriptionModal(true);
                        }}
                      >
                        Edit
                      </Button>
                    ) : null}
                    {experiment.description ? (
                      <FaAngleRight className="chevron" />
                    ) : null}
                  </Flex>
                </Flex>
              </Box>
            }
          >
            {experiment.description ? (
              <ScrollArea
                style={{
                  maxHeight: "491px",
                }}
                className="py-2 fade-mask-vertical-1rem"
              >
                <Markdown>{experiment.description}</Markdown>
              </ScrollArea>
            ) : (
              <Box as="div" className="font-italic text-muted" py="2">
                Add a description to keep your team informed about the purpose
                and parameters of your experiment
              </Box>
            )}
          </Collapsible>
        </Frame>

        {!isBandit && (
          <Frame>
            <Flex align="start" justify="between" mb="3">
              <Heading as="h4" size="3">
                Hypothesis
              </Heading>
              {canEditExperiment ? (
                <Button
                  variant="ghost"
                  onClick={() => setShowHypothesisModal(true)}
                >
                  Edit
                </Button>
              ) : null}
            </Flex>
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
          </Frame>
        )}
        <CustomFieldDisplay
          target={experiment}
          canEdit={canEditExperiment}
          mutate={mutate}
          section="experiment"
        />
      </div>
    </>
  );
}
