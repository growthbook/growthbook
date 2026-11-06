import { ReactNode } from "react";
import { PiWarning } from "react-icons/pi";
import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import ExpandableBlock from "@/components/Experiment/TabbedPage/ExpandableBlock";
import CustomFieldDisplay from "@/components/CustomFields/CustomFieldDisplay";
import Owner from "@/components/Avatar/Owner";
import SortedTags from "@/components/Tags/SortedTags";
import { tagLinkProps } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { useCustomFields } from "@/hooks/useCustomFields";
import { filterCustomFieldsForSectionAndProject } from "@/services/customFields";
import Metadata from "@/ui/Metadata";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

// Rows the details panels share, each with the quick-edit button it reveals.

export function EmptyValue({ label = "None" }: { label?: string }) {
  return (
    <Text weight="regular" color="text-mid" size="sm" fontStyle="italic">
      {label}
    </Text>
  );
}

export function HiddenProject({ id }: { id: string }) {
  return (
    <Tooltip
      content={
        <>
          A Project you don&apos;t have access to, or one that no longer exists
          (<code>{id}</code>)
        </>
      }
    >
      <em>Hidden Project</em>
    </Tooltip>
  );
}

export function OwnerField({
  owner,
  action = null,
}: {
  owner: string;
  action?: ReactNode;
}) {
  return (
    <Metadata
      size="sm"
      stacked
      label="Owner"
      action={action}
      value={
        <Owner
          ownerId={owner}
          gap="1"
          size="xs"
          textColor="text-mid"
          textSize="sm"
          truncate
        />
      }
    />
  );
}

export function ProjectField({
  project,
  action = null,
}: {
  project: string | undefined;
  action?: ReactNode;
}) {
  const {
    projects,
    project: currentProject,
    getProjectById,
  } = useDefinitions();
  const projectName = getProjectById(project || "")?.name || null;
  // The viewer's project list is read-filtered, so this is either a Project
  // they cannot see or one since deleted.
  const hidden = !!project && !projectName;
  if (!projects.length && !hidden) return null;

  return (
    <Metadata
      size="sm"
      stacked
      label="Project"
      action={action}
      value={
        !project ? (
          <EmptyValue />
        ) : (
          <Text weight="regular" color="text-mid" size="sm">
            {hidden ? (
              <HiddenProject id={project} />
            ) : currentProject && currentProject !== project ? (
              <Tooltip content="Not in your current project">
                <span>
                  {projectName} <PiWarning className="text-warning" />
                </span>
              </Tooltip>
            ) : (
              projectName
            )}
          </Text>
        )
      }
    />
  );
}

export function TagsField({
  tags,
  type,
  action = null,
}: {
  tags: string[] | undefined;
  type: Parameters<typeof tagLinkProps>[0];
  action?: ReactNode;
}) {
  return (
    <Metadata
      size="sm"
      stacked
      label="Tags"
      action={action}
      value={
        tags?.length ? (
          <SortedTags
            tags={tags}
            size="xs"
            useFlex
            shouldShowEllipsis={false}
            {...tagLinkProps(type)}
          />
        ) : (
          <EmptyValue />
        )
      }
    />
  );
}

export function CustomFieldRows({
  section,
  target,
  action,
}: {
  section: CustomFieldSection;
  target: ExperimentInterfaceStringDates | FeatureInterface;
  action: (field: CustomField) => ReactNode;
}) {
  const { hasCommercialFeature } = useUser();
  const customFields = filterCustomFieldsForSectionAndProject(
    useCustomFields(),
    section,
    target.project,
  );
  if (!hasCommercialFeature("custom-metadata") || !customFields?.length) {
    return null;
  }

  return (
    <ExpandableBlock>
      <CustomFieldDisplay
        rows
        rowAction={action}
        target={target}
        canEdit={false}
        section={section}
      />
    </ExpandableBlock>
  );
}
