import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import React, { useState } from "react";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import Collapsible from "react-collapsible";
import { FaAngleRight } from "react-icons/fa";
import { Box, Flex, ScrollArea, Heading } from "@radix-ui/themes";
import { HoldoutInterface } from "back-end/src/routers/holdout/holdout.validators";
import { upperFirst } from "lodash";
import { PiArrowSquareOut } from "react-icons/pi";
import { PreLaunchChecklist } from "@/components/Experiment/PreLaunchChecklist";
import CustomFieldDisplay from "@/components/CustomFields/CustomFieldDisplay";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Markdown from "@/components/Markdown/Markdown";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Frame from "@/ui/Frame";
import Button from "@/ui/Button";
import PremiumCallout from "@/ui/PremiumCallout";
import { useCustomFields } from "@/hooks/useCustomFields";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { useAISettings } from "@/hooks/useOrgSettings";
import OptInModal from "@/components/License/OptInModal";
import { useUser } from "@/services/UserContext";
import EditDescriptionModal from "../EditDescriptionModal";
import HoldoutTimeline from "../holdout/HoldoutTimeline";
import EditHypothesisModal from "../EditHypothesisModal";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  holdout?: HoldoutInterface;
  holdoutExperiments?: ExperimentInterfaceStringDates[];
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
  holdout,
  holdoutExperiments,
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
  const { aiEnabled, aiAgreedTo } = useAISettings();
  const [showOptInModal, setShowOptInModal] = useState(false);
  const [showHypothesisModal, setShowHypothesisModal] = useState(false);
  const [showDescriptionModal, setShowDescriptionModal] = useState(false);
  const [expandDescription, setExpandDescription] = useLocalStorage(
    `collapse-${experiment.id}-description`,
    localStorage.getItem(`collapse-${experiment.id}-description`) === "true"
      ? false
      : true,
  );
  const customFields = useCustomFields();

  const permissionsUtil = usePermissionsUtil();

  const canEditExperiment =
    !experiment.archived &&
    permissionsUtil.canViewExperimentModal(experiment.project) &&
    !disableEditing;

  const isBandit = experiment.type === "multi-armed-bandit";
  const isHoldout = experiment.type === "holdout";
  const showHoldoutTimeline =
    isHoldout &&
    holdout &&
    experiment.status !== "draft" &&
    holdoutExperiments &&
    experiment.phases[0]?.dateStarted &&
    new Date(experiment.phases[0].dateStarted) &&
    holdoutExperiments.length > 0 &&
    holdoutExperiments.some((e) => e.status !== "draft");
  const { hasCommercialFeature } = useUser();
  const hasAISuggestions = hasCommercialFeature("ai-suggestions");

  return (
    <>
      {showOptInModal && (
        <OptInModal
          agreement="ai"
          onConfirm={() => {
            setShowOptInModal(false);
            setShowHypothesisModal(true);
          }}
          onClose={() => setShowOptInModal(false)}
        />
      )}
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
          experimentType={experiment.type}
          initialValue={experiment.description}
          close={() => setShowDescriptionModal(false)}
        />
      ) : null}
      <div>
        <h2>Overview</h2>
        {experiment.status === "draft" && experiment.type !== "holdout" ? (
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
                and parameters of your{" "}
                {upperFirst(experiment.type || "experiment")}.
              </Box>
            )}
            {!customFields.length && experiment.description && !isHoldout ? (
              <PremiumCallout
                mt="3"
                commercialFeature="custom-metadata"
                dismissable={true}
                id="exp-description-custom-metadata"
                docSection="customMetadata"
              >
                <strong>Custom Fields</strong> add structured metadata to
                experiments and feature flags, like Jira links, categories and
                more.
              </PremiumCallout>
            ) : null}
          </Collapsible>
        </Frame>

        {showHoldoutTimeline && (
          <div className="box p-4 my-4">
            <HoldoutTimeline
              experiments={holdoutExperiments}
              startDate={
                experiment.phases[0]?.dateStarted
                  ? new Date(experiment.phases[0].dateStarted)
                  : new Date()
              }
              holdoutEndDate={
                experiment.phases[0]?.dateEnded
                  ? new Date(experiment.phases[0].dateEnded)
                  : undefined
              }
            />
          </div>
        )}

        {!isBandit && !isHoldout && (
          <Frame>
            <Flex align="start" justify="between" mb="3">
              <Heading as="h4" size="3">
                Hypothesis
              </Heading>
              {canEditExperiment && (
                <Button
                  variant="ghost"
                  onClick={() => setShowHypothesisModal(true)}
                >
                  Edit
                </Button>
              )}
            </Flex>
            <div className="mb-3">
              {!experiment.hypothesis ? (
                <span className="font-italic text-muted">
                  Add a hypothesis statement to help focus the nature of your
                  experiment
                </span>
              ) : (
                experiment.hypothesis
              )}
            </div>

            {!hasAISuggestions ? (
              <PremiumCallout
                id="ai-suggestions-hypothesis"
                commercialFeature="ai-suggestions"
              >
                <span>Improve your hypothesis with AI. </span>
              </PremiumCallout>
            ) : aiEnabled && aiAgreedTo ? (
              <Callout status="wizard" contentsAs="div">
                <span>
                  Set hypothesis formatting standards for the organization in
                  General Settings.{" "}
                  <Link
                    href="/settings/#ai"
                    className="underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Edit Hypothesis
                  </Link>
                  <PiArrowSquareOut className="ml-1" />
                </span>
              </Callout>
            ) : !aiEnabled && aiAgreedTo ? (
              <Callout status="wizard" contentsAs="div">
                <span>
                  Improve your hypothesis with AI.{" "}
                  <Link
                    href="/settings/#ai"
                    className="underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Enable AI from General Settings
                  </Link>
                  <PiArrowSquareOut className="ml-1" />
                </span>
              </Callout>
            ) : (
              <Callout status="wizard" contentsAs="div">
                <span>
                  Improve your hypothesis with AI.{" "}
                  <Link
                    onClick={() => {
                      setShowOptInModal(true);
                    }}
                    className="underline"
                  >
                    Enable AI
                  </Link>
                  <PiArrowSquareOut className="ml-1" />
                </span>
              </Callout>
            )}
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
