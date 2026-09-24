import { ReactNode } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Flex } from "@radix-ui/themes";
import { date, daysBetween } from "shared/dates";
import { PiWarning } from "react-icons/pi";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { getImplementationType } from "shared/util";
import { IMPLEMENTATION_TYPE_OPTIONS } from "@/components/Experiment/ImplementationTypeSelect";
import Text from "@/ui/Text";
import SortedTags from "@/components/Tags/SortedTags";
import { tagLinkProps } from "@/services/search";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import Owner from "@/components/Avatar/Owner";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useHoldouts } from "@/hooks/useHoldouts";
import ProjectBadges from "@/components/ProjectBadges";
import { FocusSelector } from "./EditExperimentInfoModal";

export interface Props {
  /** The experiment owns a managed Feature Flag. */
  isManaged?: boolean;
  experiment: ExperimentInterfaceStringDates;
  holdout?: HoldoutInterfaceStringDates;
  setShowEditInfoModal: (value: boolean) => void;
  setEditInfoFocusSelector: (value: FocusSelector) => void;
  /** Set while the page holds unsaved edits: the add links say so instead. */
  editsBlockedReason?: string | null;
  editTags?: (() => void) | null;
  /** Stack the fields for the side panel instead of the header's wrapping row. */
  vertical?: boolean;
  /** The quick-edit button for one field's row, where that field is editable. */
  fieldAction?: (
    field: "project" | "trackingKey" | "owner" | "tags",
  ) => ReactNode;
}

export default function ProjectTagBar({
  experiment,
  holdout,
  setShowEditInfoModal,
  setEditInfoFocusSelector,
  editsBlockedReason,
  editTags,
  isManaged,
  vertical,
  fieldAction,
}: Props) {
  const {
    projects,
    project: currentProject,
    getProjectById,
  } = useDefinitions();

  const projectId = experiment.project;
  const project = getProjectById(experiment.project || "");
  const projectName = project?.name || null;
  const projectIsDeReferenced = projectId && !projectName;

  // Only needed to name the holdout this experiment belongs to.
  const { holdoutsMap } = useHoldouts(undefined, false, {
    enabled: !!experiment.holdoutId,
  });

  const permissionsUtil = usePermissionsUtil();
  const canUpdateExperimentProject = (project) =>
    permissionsUtil.canUpdateExperiment({ project }, {});
  // Experiments adopted before the type was stored only carry the flag's marker.
  const implementationType = isManaged
    ? "values"
    : getImplementationType(experiment);

  const canUpdateHoldoutProjects = (projects) =>
    permissionsUtil.canUpdateHoldout({ projects }, { projects: [] });

  const trackingKey = experiment.trackingKey;

  const toUTCDate = (dateValue: string | Date) => date(dateValue, "UTC");

  const createdDate = toUTCDate(experiment.dateCreated);

  const isHoldout = experiment.type === "holdout";

  const hasMultiplePhases = (experiment.phases?.length ?? 0) > 1;

  const latestPhase = experiment.phases?.[experiment.phases.length - 1];

  const showRuntime =
    experiment.phases?.length > 0 &&
    experiment.status !== "draft" &&
    latestPhase?.dateStarted;

  const renderRuntime = () => {
    const phases = experiment.phases || [];
    const numPhases = phases.length;

    // If no phases: If experiment start date ? `experiment start date - now` : "not started"
    if (numPhases === 0) {
      return "not started";
    }

    // If holdout, total runtime from first phase to latest phase
    // If not holdout, latest phase runtime
    const firstPhase = phases[0];
    const lastPhase = phases[phases.length - 1];
    const startDate = isHoldout
      ? toUTCDate(firstPhase?.dateStarted ?? "")
      : toUTCDate(lastPhase?.dateStarted ?? "");
    const endDate = lastPhase?.dateEnded
      ? toUTCDate(lastPhase.dateEnded)
      : "now";

    if (!startDate) {
      return "not started";
    }

    return `${startDate} - ${endDate}`;
  };

  const renderTotalRuntimeTooltip = (): JSX.Element | string => {
    const phases = experiment.phases || [];
    const numPhases = phases.length;

    if (numPhases === 0) {
      return "";
    }

    const firstPhase = phases[0];
    const lastPhase = phases[phases.length - 1];

    // Get the actual start date (not formatted)
    const startDateStr = isHoldout
      ? firstPhase.dateStarted
      : lastPhase.dateStarted;

    if (!startDateStr) {
      return "";
    }

    // Get the end date (or use now)
    const endDateStr = lastPhase?.dateEnded || new Date().toISOString();

    const days = daysBetween(startDateStr, endDateStr);

    // Format the date range
    const startDateFormatted = toUTCDate(startDateStr);
    const endDateFormatted = lastPhase?.dateEnded
      ? toUTCDate(lastPhase.dateEnded)
      : "now";

    return (
      <>
        <strong>Total runtime</strong>
        <br />
        {startDateFormatted} - {endDateFormatted} ({days}{" "}
        {days === 1 ? "day" : "days"})
      </>
    );
  };

  const renderOwner = () => {
    return (
      <Owner
        ownerId={experiment.owner}
        gap="1"
        size="xs"
        textColor="text-mid"
        textSize="sm"
        truncate
      />
    );
  };

  const RenderToolTipsAndValue = () => {
    if (projectIsDeReferenced) {
      return (
        <Tooltip
          body={
            <>
              Project <code>{projectId}</code> not found
            </>
          }
        >
          <span className="text-danger">
            <PiWarning /> Invalid project
          </span>
        </Tooltip>
      );
    } else if (currentProject && currentProject !== experiment.project) {
      return (
        <Tooltip body={<>This experiment is not in your current project.</>}>
          {projectId && <strong>{projectName}</strong>}{" "}
          <PiWarning className="text-warning" />
        </Tooltip>
      );
    } else {
      return (
        projectId && (
          <Text weight="regular" color="text-mid" size="sm">
            {projectName}
          </Text>
        )
      );
    }
  };
  const showAddLinks = !vertical;

  const addLink = (focus: FocusSelector) =>
    editsBlockedReason ? (
      <Tooltip body={editsBlockedReason}>
        <Text color="text-disabled" size="sm">
          +Add
        </Text>
      </Tooltip>
    ) : (
      <Link
        onClick={(e) => {
          e.preventDefault();
          setEditInfoFocusSelector(focus);
          setShowEditInfoModal(true);
        }}
      >
        +Add
      </Link>
    );

  const renderProjectMetaDataValue = () => {
    return (
      <Flex gap="1">
        {RenderToolTipsAndValue()}
        {showAddLinks &&
          canUpdateExperimentProject(project) &&
          !projectId &&
          addLink("project")}
        {(!showAddLinks || !canUpdateExperimentProject(project)) &&
          !projectId && (
            <Text
              weight="regular"
              color="text-mid"
              size="sm"
              fontStyle="italic"
            >
              None
            </Text>
          )}
      </Flex>
    );
  };

  const renderHoldoutProjectMetaDataValue = () => {
    if (!holdout) {
      return null;
    }

    return (
      <Flex gap="1">
        {holdout.projects.length > 0 && (
          <ProjectBadges resourceType="holdout" projectIds={holdout.projects} />
        )}
        {showAddLinks &&
          canUpdateHoldoutProjects(holdout.projects) &&
          holdout.projects.length === 0 &&
          addLink("projects")}
        {(!showAddLinks || !canUpdateHoldoutProjects(holdout.projects)) &&
          holdout.projects.length === 0 && (
            <Text
              weight="regular"
              color="text-mid"
              size="sm"
              fontStyle="italic"
            >
              None
            </Text>
          )}
      </Flex>
    );
  };

  const renderProject = () => {
    return (projects.length > 0 || projectIsDeReferenced) && !holdout ? (
      <Metadata
        size="sm"
        row={vertical}
        label="Project"
        actionPlacement="value"
        action={fieldAction?.("project")}
        value={renderProjectMetaDataValue()}
      />
    ) : holdout ? (
      <Metadata
        size="sm"
        row={vertical}
        label="Projects"
        value={renderHoldoutProjectMetaDataValue()}
      />
    ) : null;
  };
  const renderTagsValue = () => {
    return (
      <Flex gap="1">
        {experiment.tags?.length > 0 && (
          <SortedTags
            tags={experiment.tags}
            size="xs"
            useFlex
            shouldShowEllipsis={false}
            {...tagLinkProps("experiments")}
          />
        )}
        {showAddLinks &&
          editTags &&
          experiment.tags?.length === 0 &&
          addLink("tags")}
        {(!showAddLinks || !editTags) && experiment.tags?.length === 0 && (
          <Text weight="regular" color="text-mid" size="sm" fontStyle="italic">
            None
          </Text>
        )}
      </Flex>
    );
  };
  return (
    <div className={vertical ? undefined : "pb-3"}>
      <Flex
        direction={vertical ? "column" : "row"}
        gap={vertical ? "2" : "3"}
        mt={vertical ? "0" : "2"}
        mb={vertical ? "0" : "1"}
        wrap={vertical ? "nowrap" : "wrap"}
      >
        {renderProject()}
        {experiment.type !== "holdout" && (
          <Metadata
            size="sm"
            row={vertical}
            label="Implementation"
            value={
              implementationType ? (
                IMPLEMENTATION_TYPE_OPTIONS[implementationType].header
              ) : (
                <Text
                  weight="regular"
                  color="text-mid"
                  size="sm"
                  fontStyle="italic"
                >
                  Not set
                </Text>
              )
            }
          />
        )}
        {experiment.type !== "holdout" && (
          <Metadata
            size="sm"
            row={vertical}
            label="Experiment Key"
            actionPlacement="value"
            action={fieldAction?.("trackingKey")}
            value={
              trackingKey || (
                <Text
                  weight="regular"
                  color="text-mid"
                  size="sm"
                  fontStyle="italic"
                >
                  None
                </Text>
              )
            }
          />
        )}
        {experiment.holdoutId && (
          <Metadata
            size="sm"
            row={vertical}
            label="Holdout"
            value={
              <Link href={`/holdout/${experiment.holdoutId}`}>
                {holdoutsMap.get(experiment.holdoutId)?.name}
              </Link>
            }
          />
        )}
        <Metadata
          size="sm"
          row={vertical}
          label="Owner"
          actionPlacement="value"
          action={fieldAction?.("owner")}
          value={renderOwner()}
        />
        <Metadata
          size="sm"
          row={vertical}
          label="Created"
          value={createdDate}
        />
        {showRuntime && (
          <Metadata
            size="sm"
            row={vertical}
            label={
              hasMultiplePhases && experiment.type !== "holdout"
                ? "Latest Phase"
                : "Runtime"
            }
            value={
              <Tooltip body={renderTotalRuntimeTooltip()}>
                <Text weight="regular" color="text-mid" size="sm">
                  {renderRuntime()}
                </Text>
              </Tooltip>
            }
          />
        )}
        {vertical && (
          <Metadata
            size="sm"
            // Tags wrap, so they get the column's full width under the label.
            stacked
            label="Tags"
            actionPlacement="value"
            action={fieldAction?.("tags")}
            value={renderTagsValue()}
          />
        )}
      </Flex>
      {!vertical && (
        <div className="row mt-2">
          <div className="col-auto">
            <Metadata
              size="sm"
              row={vertical}
              label="Tags"
              value={renderTagsValue()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
