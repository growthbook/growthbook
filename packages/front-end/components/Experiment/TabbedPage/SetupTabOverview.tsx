import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useState } from "react";
import Collapsible from "react-collapsible";
import { FaAngleRight } from "react-icons/fa";
import { Box, Flex, ScrollArea } from "@radix-ui/themes";
import { HoldoutInterfaceStringDates } from "shared/validators";
import {
  PiArrowSquareOut,
  PiPencilSimpleFill,
  PiPlus,
  PiWarningFill,
} from "react-icons/pi";
import { format } from "date-fns-tz";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { PreLaunchChecklistDrawer } from "@/components/PreLaunchChecklist/PreLaunchChecklist";
import CustomFieldDisplay from "@/components/CustomFields/CustomFieldDisplay";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Markdown from "@/components/Markdown/Markdown";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Frame from "@/ui/Frame";
import PremiumCallout from "@/ui/PremiumCallout";
import { useCustomFields } from "@/hooks/useCustomFields";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { useAISettings } from "@/hooks/useOrgSettings";
import OptInModal from "@/components/License/OptInModal";
import { useUser } from "@/services/UserContext";
import EditDescriptionModal from "@/components/Experiment/EditDescriptionModal";
import HoldoutTimeline from "@/components/Experiment/holdout/HoldoutTimeline";
import EditHypothesisModal from "@/components/Experiment/EditHypothesisModal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import { HoldoutSchedule } from "@/components/Holdout/HoldoutSchedule";
import Heading from "@/ui/Heading";
import Tooltip from "@/ui/Tooltip";
import Text from "@/ui/Text";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  holdout?: HoldoutInterfaceStringDates;
  holdoutExperiments?: ExperimentInterfaceStringDates[];
  mutate: () => void;
  disableEditing?: boolean;
  editSchedule?: (() => void) | null;
}

export default function SetupTabOverview({
  experiment,
  holdout,
  holdoutExperiments,
  mutate,
  disableEditing,
  editSchedule,
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
  const { apiCall } = useAuth();
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
  const canEditSchedule = !isBandit && canEditExperiment && editSchedule;
  const holdoutHasSchedule =
    isHoldout &&
    holdout &&
    Object.values(holdout.statusUpdateSchedule ?? {}).some(
      (value) => value !== null,
    );
  const experimentHasSchedule =
    experiment.statusUpdateSchedule &&
    Object.values(experiment.statusUpdateSchedule).some(
      (value) => value !== null,
    );
  const experimentScheduleApproved = !!experiment.nextScheduledStatusUpdate;
  const showAddHoldoutSchedule =
    canEditSchedule &&
    isHoldout &&
    !holdoutHasSchedule &&
    experiment.status !== "stopped" &&
    !experiment.archived;

  const showAddExperimentSchedule =
    canEditSchedule &&
    !isHoldout &&
    !isBandit &&
    !experimentHasSchedule &&
    experiment.status === "draft" &&
    !experiment.archived;

  const showScheduleIsInThePastWarning =
    !!experiment.statusUpdateSchedule?.startAt &&
    new Date(experiment.statusUpdateSchedule.startAt) < new Date();

  const { hasCommercialFeature, organization } = useUser();
  const hasAISuggestions = hasCommercialFeature("ai-suggestions");
  const isDemoExperiment =
    !!experiment.project &&
    experiment.project ===
      getDemoDatasourceProjectIdForOrganization(organization.id);

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
        <Flex justify="between" align="baseline" mb="3">
          <Heading color="text-high" as="h2" size="large" mb="0">
            Overview
          </Heading>
          <Flex align="center" gap="4">
            {canEditExperiment && !experiment.description && !isHoldout ? (
              <Link onClick={() => setShowDescriptionModal(true)}>
                <Flex align="center" gap="1">
                  <PiPlus size="15" />
                  <Text weight="semibold">Add Description</Text>
                </Flex>
              </Link>
            ) : null}
            {showAddHoldoutSchedule || showAddExperimentSchedule ? (
              <Link onClick={() => editSchedule()}>
                <Flex align="center" gap="1">
                  <PiPlus size="15" />
                  <Text weight="semibold">Add Schedule</Text>
                </Flex>
              </Link>
            ) : null}
            {experiment.status === "draft" &&
            experiment.type !== "holdout" &&
            experimentHasSchedule &&
            !experimentScheduleApproved &&
            editSchedule ? (
              <Tooltip
                content="Scheduled start date has passed—edit scheduled time"
                enabled={showScheduleIsInThePastWarning}
              >
                <Link onClick={() => editSchedule()}>
                  <Flex align="center" gap="1">
                    {showScheduleIsInThePastWarning && (
                      <PiWarningFill color="var(--warning)" />
                    )}
                    <Text weight="semibold">
                      Target Start:{" "}
                      {experiment.statusUpdateSchedule?.startAt
                        ? format(
                            new Date(experiment.statusUpdateSchedule.startAt),
                            "MMM d, yyyy 'at' h:mm a (z)",
                          )
                        : ""}
                    </Text>
                    <PiPencilSimpleFill />
                  </Flex>
                </Link>
              </Tooltip>
            ) : null}
          </Flex>
        </Flex>
        {isHoldout && holdout && holdoutHasSchedule && editSchedule ? (
          <Frame id="holdout-schedule" style={{ scrollMarginTop: "100px" }}>
            <Flex align="center" justify="between" className="text-dark">
              <Heading color="text-high" mb="0" as="h4" size="small">
                Holdout Schedule
              </Heading>
              <Flex align="center" gap="2">
                {canEditSchedule ? (
                  <>
                    <DeleteButton
                      text="Delete"
                      displayName="Schedule"
                      deleteMessage="Deleting the schedule will remove the automatic transition of the Holdout from start, to analysis, to stopped. Manual intervention will be required for each transition if no schedule is set."
                      onClick={async () => {
                        await apiCall<HoldoutInterfaceStringDates>(
                          `/holdout/${holdout.id}`,
                          {
                            method: "PUT",
                            body: JSON.stringify({
                              statusUpdateSchedule: null,
                              nextScheduledStatusUpdate: null,
                            }),
                          },
                        );
                        mutate();
                      }}
                    />
                    <Link
                      mr={experiment.description ? "3" : "0"}
                      onClick={(e) => {
                        e.stopPropagation();
                        editSchedule();
                      }}
                    >
                      <Text weight="semibold">Edit</Text>
                    </Link>
                  </>
                ) : null}
              </Flex>
            </Flex>
            <HoldoutSchedule holdout={holdout} experiment={experiment} />
          </Frame>
        ) : null}

        {!isBandit && !isHoldout && (
          <Frame>
            <Flex align="start" justify="between">
              <Heading color="text-high" as="h4" size="small" mb="0">
                Hypothesis
              </Heading>
              {canEditExperiment && (
                <Link onClick={() => setShowHypothesisModal(true)}>
                  <Text weight="semibold">Edit</Text>
                </Link>
              )}
            </Flex>
            {experiment.hypothesis ? (
              <>
                <Box my="3">
                  <Markdown>{experiment.hypothesis}</Markdown>
                </Box>

                {isDemoExperiment ? null : !hasAISuggestions ? (
                  <PremiumCallout
                    id="ai-suggestions-hypothesis"
                    commercialFeature="ai-suggestions"
                  >
                    <span>Improve your hypothesis with AI. </span>
                  </PremiumCallout>
                ) : aiEnabled && aiAgreedTo ? (
                  <Callout
                    status="wizard"
                    dismissible
                    id="hypothesis-formatting-standards"
                  >
                    <span>
                      Set hypothesis formatting standards for the organization
                      in General Settings.{" "}
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
                  <Callout status="wizard">
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
                  <Callout status="wizard">
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
              </>
            ) : null}
          </Frame>
        )}

        {experiment.description || isHoldout ? (
          <Frame>
            <Collapsible
              open={!!experiment.description && expandDescription}
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
                    <Heading color="text-high" mb="0" as="h4" size="small">
                      Description
                    </Heading>
                    <Flex align="center" gap="2">
                      {canEditExperiment ? (
                        <Link
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowDescriptionModal(true);
                          }}
                        >
                          <Text weight="semibold">Edit</Text>
                        </Link>
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
                <>
                  <ScrollArea
                    style={{
                      maxHeight: "491px",
                    }}
                    className="py-2 fade-mask-vertical-1rem"
                  >
                    <Markdown>{experiment.description}</Markdown>
                  </ScrollArea>
                  {!customFields.length &&
                  experiment.description &&
                  !isHoldout &&
                  !isDemoExperiment ? (
                    <PremiumCallout
                      mt="3"
                      commercialFeature="custom-metadata"
                      dismissible={true}
                      id="exp-description-custom-metadata"
                      docSection="customMetadata"
                    >
                      <strong>Custom Fields</strong> add structured metadata to
                      experiments and feature flags, like Jira links, categories
                      and more.
                    </PremiumCallout>
                  ) : null}
                </>
              ) : null}
            </Collapsible>
          </Frame>
        ) : null}

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

        <CustomFieldDisplay
          target={experiment}
          canEdit={canEditExperiment}
          mutate={mutate}
          section="experiment"
        />
      </div>
      {experiment.status === "draft" && experiment.type !== "holdout" && (
        <PreLaunchChecklistDrawer />
      )}
    </>
  );
}
