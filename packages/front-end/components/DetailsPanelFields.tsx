import { ReactNode } from "react";
import { PiWarning } from "react-icons/pi";
import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import CustomFieldDisplay from "@/components/CustomFields/CustomFieldDisplay";
import Owner from "@/components/Avatar/Owner";
import QuickEditButton from "@/components/Experiment/TabbedPage/QuickEditButton";
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

// A row's edit pencil, disabled with the reason when edits are blocked. Pass
// it only where the viewer may edit: any action makes its row an action row.
export function PanelEditButton({
  label,
  onClick,
  blockedReason = null,
}: {
  label: string;
  onClick: () => void;
  blockedReason?: string | null;
}) {
  return (
    <QuickEditButton
      label={label}
      onClick={onClick}
      blockedReason={blockedReason}
      labelTooltip={false}
    />
  );
}

// A teammate in a panel row.
export function PersonValue({ id }: { id: string }) {
  return (
    <Owner
      ownerId={id}
      gap="1"
      size="xs"
      textColor="text-mid"
      textSize="sm"
      truncate
    />
  );
}

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
      {/* Focusable, so the explanation reaches keyboard users too. */}
      <em tabIndex={0}>Hidden Project</em>
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
      value={<PersonValue id={owner} />}
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
                  {projectName}{" "}
                  <PiWarning style={{ color: "var(--amber-11)" }} />
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
    <CustomFieldDisplay
      rows
      rowAction={action}
      target={target}
      canEdit={false}
      section={section}
    />
  );
}
