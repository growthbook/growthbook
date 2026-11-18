import { ReactNode } from "react";
import { PiWarning } from "react-icons/pi";
import { Box } from "@radix-ui/themes";
import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import CustomFieldDisplay from "@/components/CustomFields/CustomFieldDisplay";
import ExpandableText, {
  ExpandableTextBody,
} from "@/components/ExpandableText";
import Markdown from "@/components/Markdown/Markdown";
import CopyableCode from "@/components/Settings/CopyableCode";
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

// A key or ID that copies on click, while the rest of its row still edits.
export function CopyableKey({ value }: { value: string }) {
  return (
    <Text weight="regular" color="text-high" size="sm">
      <CopyableCode value={value} plain />
    </Text>
  );
}

// A row's value as text, as every value in a details panel reads.
export function PanelText({ children }: { children: ReactNode }) {
  return (
    <Text weight="regular" color="text-mid" size="sm">
      {children}
    </Text>
  );
}

export function EmptyValue({ label = "None" }: { label?: string }) {
  return (
    <Text weight="regular" color="text-mid" size="sm" fontStyle="italic">
      {label}
    </Text>
  );
}

// Markdown cut off after its first lines. The row edits wherever it's
// clicked, so only its "… expand" opens the rest.
export function MarkdownValue({ markdown }: { markdown?: string }) {
  if (!markdown) return <EmptyValue />;
  return (
    <Box width="100%">
      <ExpandableText expandOnClick={false}>
        <ExpandableTextBody>
          <Text as="div" size="sm" color="text-mid">
            <Markdown>{markdown}</Markdown>
          </Text>
        </ExpandableTextBody>
      </ExpandableText>
    </Box>
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
              <Tooltip content="Not in your current Project">
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
