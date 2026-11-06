import { useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { ago, datetime } from "shared/dates";
import {
  ACTIVE_DRAFT_STATUSES,
  HoldoutInterface,
  eventUserPersonId,
} from "shared/validators";
import DetailsPanel, {
  DetailsPanelTab,
  PanelSection,
} from "@/components/DetailsPanel";
import {
  CustomFieldRows,
  EmptyValue,
  HiddenProject,
  OwnerField,
  ProjectField,
  TagsField,
} from "@/components/DetailsPanelFields";
import QuickEditButton from "@/components/Experiment/TabbedPage/QuickEditButton";
import ExpandableText, {
  ExpandableTextBody,
} from "@/components/ExpandableText";
import EditFeatureDescriptionModal from "@/components/Features/EditFeatureDescriptionModal";
import EditFeatureInfoModal, {
  FeatureInfoSection,
  SECTION_HEADERS,
} from "@/components/Features/EditFeatureInfoModal";
import FeatureValueTypeDisplay from "@/components/Features/FeatureValueTypeDisplay";
import Markdown from "@/components/Markdown/Markdown";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import EventUser from "@/components/Avatar/EventUser";
import Owner from "@/components/Avatar/Owner";
import EditRevisionDescriptionModal from "@/components/Reviews/EditRevisionDescriptionModal";
import EditRevisionTitleModal from "@/components/Reviews/EditRevisionTitleModal";
import RevisionStatusBadge from "@/components/Reviews/RevisionStatusBadge";
import { FeatureDependents } from "@/hooks/useFeatureDependents";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

export default function FeatureDetailsPanel({
  feature,
  baseFeature,
  revision,
  revisionList,
  holdout,
  dependents,
  canEdit,
  mutate,
  setVersion,
  tab,
  setTab,
}: {
  // The feature as viewed (draft changes merged in) and as published.
  feature: FeatureInterface;
  baseFeature: FeatureInterface;
  // The revision being viewed.
  revision: FeatureRevisionInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  holdout: HoldoutInterface | undefined;
  // Features and experiments that use this feature as a prerequisite.
  dependents: FeatureDependents | null;
  canEdit: boolean;
  mutate: () => void;
  setVersion: (v: number) => void;
  tab: DetailsPanelTab;
  setTab: (tab: DetailsPanelTab) => void;
}) {
  const [infoSection, setInfoSection] = useState<FeatureInfoSection | null>(
    null,
  );
  const [customFieldId, setCustomFieldId] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState(false);
  const [renamingRevision, setRenamingRevision] = useState(false);
  const [describingRevision, setDescribingRevision] = useState(false);
  const { apiCall } = useAuth();
  const editSection = (
    section: FeatureInfoSection,
    fieldId: string | null = null,
  ) => {
    setInfoSection(section);
    setCustomFieldId(fieldId);
  };
  const pencil = (label: string, onClick: () => void) =>
    canEdit ? (
      <QuickEditButton label={label} onClick={onClick} labelTooltip={false} />
    ) : null;
  const fieldAction = (section: FeatureInfoSection) =>
    pencil(SECTION_HEADERS[section], () => editSection(section));

  const liveVersion = baseFeature.version;
  const isDraft = (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(
    revision.status,
  );
  // Published and discarded revisions keep what they shipped with.
  const revisionAction = (label: string, onClick: () => void) =>
    isDraft ? pencil(label, onClick) : null;
  const createdBy = revision.createdBy;
  const authorId = eventUserPersonId(createdBy ?? null);
  // Everyone else who edited the draft.
  const coAuthorIds = (revision.contributors ?? []).filter(
    (id) => id !== authorId,
  );

  const { projects, getProjectById } = useDefinitions();
  const targetingProjects = feature.targetingProjects ?? [];
  const dependentFeatures = dependents?.features ?? [];
  const dependentExperiments = dependents?.experiments ?? [];
  const dependentCount = dependentFeatures.length + dependentExperiments.length;

  return (
    <>
      {infoSection ? (
        <EditFeatureInfoModal
          feature={feature}
          baseFeature={baseFeature}
          revisionList={revisionList}
          section={infoSection}
          customFieldId={customFieldId}
          source="feature-details-panel"
          dependents={dependentCount}
          cancel={() => setInfoSection(null)}
          mutate={mutate}
          setVersion={setVersion}
        />
      ) : null}
      {renamingRevision ? (
        <EditRevisionTitleModal
          initialValue={revision.title ?? ""}
          version={revision.version}
          close={() => setRenamingRevision(false)}
          onSubmit={async (title) => {
            await apiCall(`/feature/${feature.id}/${revision.version}/title`, {
              method: "PUT",
              body: JSON.stringify({ title }),
            });
            mutate();
          }}
        />
      ) : null}
      {describingRevision ? (
        <EditRevisionDescriptionModal
          initialValue={revision.comment ?? ""}
          revision={revision}
          liveVersion={liveVersion}
          close={() => setDescribingRevision(false)}
          onSubmit={async (comment) => {
            await apiCall(
              `/feature/${feature.id}/${revision.version}/comment`,
              { method: "PUT", body: JSON.stringify({ comment }) },
            );
            mutate();
          }}
        />
      ) : null}
      {editingDescription ? (
        <EditFeatureDescriptionModal
          close={() => setEditingDescription(false)}
          feature={feature}
          revisionList={revisionList}
          mutate={mutate}
          setVersion={setVersion}
        />
      ) : null}
      <DetailsPanel
        tab={tab}
        setTab={setTab}
        discussion={{
          type: "feature",
          id: feature.id,
          projects: feature.project ? [feature.project] : [],
          allowNewComments: true,
        }}
      >
        <PanelSection title="General">
          <Metadata size="sm" stacked label="Feature key" value={feature.id} />
          <Metadata
            size="sm"
            stacked
            label="Description"
            action={pencil("Edit description", () =>
              setEditingDescription(true),
            )}
            value={
              feature.description ? (
                <Box width="100%">
                  {/* The row edits wherever it's clicked; only its "… expand"
                      opens the rest. */}
                  <ExpandableText expandOnClick={false}>
                    <ExpandableTextBody>
                      <Text as="div" size="sm" color="text-mid">
                        <Markdown>{feature.description}</Markdown>
                      </Text>
                    </ExpandableTextBody>
                  </ExpandableText>
                </Box>
              ) : (
                <EmptyValue />
              )
            }
          />
          <OwnerField owner={feature.owner} action={fieldAction("owner")} />
          <ProjectField
            project={feature.project}
            action={fieldAction("project")}
          />
          {projects.length > 0 ||
          feature.targetingAllProjects ||
          targetingProjects.length > 0 ? (
            <Metadata
              size="sm"
              stacked
              label="Targeting projects"
              action={fieldAction("targetingProjects")}
              value={
                feature.targetingAllProjects ? (
                  <Text weight="regular" color="text-mid" size="sm">
                    All Projects
                  </Text>
                ) : targetingProjects.length > 0 ? (
                  <Text weight="regular" color="text-mid" size="sm">
                    {targetingProjects.map((id, i) => (
                      <span key={id}>
                        {i > 0 ? ", " : ""}
                        {getProjectById(id)?.name || <HiddenProject id={id} />}
                      </span>
                    ))}
                  </Text>
                ) : (
                  <EmptyValue />
                )
              }
            />
          ) : null}
          <Metadata
            size="sm"
            stacked
            label="Type"
            value={
              <Text weight="regular" color="text-mid" size="sm">
                <FeatureValueTypeDisplay
                  valueType={feature.valueType}
                  baseConfig={feature.baseConfig}
                  maxWidth={200}
                />
              </Text>
            }
          />
          {holdout?.id ? (
            <Metadata
              size="sm"
              stacked
              label="Holdout"
              value={
                <Text size="sm">
                  <Link href={`/holdout/${holdout.id}`}>{holdout.name}</Link>
                </Text>
              }
            />
          ) : null}
          <TagsField
            tags={feature.tags}
            type="features"
            action={fieldAction("tags")}
          />
          <CustomFieldRows
            section="feature"
            target={feature}
            action={(field) =>
              pencil(`Edit ${field.name}`, () =>
                editSection("customFields", field.id),
              )
            }
          />
        </PanelSection>
        {dependentCount > 0 ? (
          <>
            <Separator size="4" />
            <PanelSection title={`Dependents (${dependentCount})`}>
              <Text as="p" size="sm" color="text-low" mb="0">
                <em>This feature is a prerequisite for the following:</em>
              </Text>
              {dependentFeatures.length > 0 ? (
                <Metadata
                  size="sm"
                  stacked
                  label="Features"
                  value={
                    <Flex direction="column" gap="1">
                      {dependentFeatures.map((fid) => (
                        <Text key={fid} size="sm">
                          <Link href={`/features/${fid}`}>{fid}</Link>
                        </Text>
                      ))}
                    </Flex>
                  }
                />
              ) : null}
              {dependentExperiments.length > 0 ? (
                <Metadata
                  size="sm"
                  stacked
                  label="Experiments"
                  value={
                    <Flex direction="column" gap="1">
                      {dependentExperiments.map((exp) => (
                        <Text key={exp.id} size="sm">
                          <Link href={`/experiment/${exp.id}`}>{exp.name}</Link>
                        </Text>
                      ))}
                    </Flex>
                  }
                />
              ) : null}
            </PanelSection>
          </>
        ) : null}
        <Separator size="4" />
        <PanelSection
          title={`Revision ${revision.version}`}
          badge={
            <RevisionStatusBadge
              revision={revision}
              liveVersion={liveVersion}
            />
          }
        >
          <Metadata
            size="sm"
            stacked
            label="Name"
            action={revisionAction("Rename revision", () =>
              setRenamingRevision(true),
            )}
            value={
              revision.title ? (
                <Text weight="regular" color="text-mid" size="sm">
                  {revision.title}
                </Text>
              ) : (
                <EmptyValue />
              )
            }
          />
          <Metadata
            size="sm"
            stacked
            label="Description"
            action={revisionAction("Edit revision description", () =>
              setDescribingRevision(true),
            )}
            value={
              revision.comment ? (
                <Box width="100%">
                  <ExpandableText expandOnClick={false}>
                    <ExpandableTextBody>
                      <Text as="div" size="sm" color="text-mid">
                        <Markdown>{revision.comment}</Markdown>
                      </Text>
                    </ExpandableTextBody>
                  </ExpandableText>
                </Box>
              ) : (
                <EmptyValue />
              )
            }
          />
          {isDraft &&
          revision.baseVersion !== undefined &&
          revision.baseVersion !== liveVersion ? (
            <Metadata
              size="sm"
              stacked
              label="Based on"
              value={`Revision ${revision.baseVersion}`}
            />
          ) : null}
          {createdBy?.type === "dashboard" || createdBy?.type === "api_key" ? (
            <Metadata
              size="sm"
              stacked
              label="Revised by"
              value={
                authorId ? (
                  <RailPerson id={authorId} />
                ) : (
                  <Text size="sm" color="text-mid">
                    <EventUser
                      user={createdBy}
                      display="avatar-name"
                      size="xs"
                    />
                  </Text>
                )
              }
            />
          ) : createdBy?.type === "system" ? (
            <Metadata
              size="sm"
              stacked
              label="Generated by"
              value={
                createdBy.subtype === "ramp-schedule"
                  ? "Ramp schedule"
                  : "System"
              }
            />
          ) : null}
          {coAuthorIds.length > 0 ? (
            <Metadata
              size="sm"
              stacked
              label={coAuthorIds.length === 1 ? "Co-author" : "Co-authors"}
              value={
                <Flex direction="column" gap="1">
                  {coAuthorIds.map((id) => (
                    <RailPerson key={id} id={id} />
                  ))}
                </Flex>
              }
            />
          ) : null}
          {revision.status === "published" && revision.datePublished ? (
            <Metadata
              size="sm"
              stacked
              label="Published"
              value={datetime(revision.datePublished)}
            />
          ) : (
            <Metadata
              size="sm"
              stacked
              label="Last update"
              value={ago(revision.dateUpdated)}
            />
          )}
          {isDraft && revision.scheduledPublishAt ? (
            <Metadata
              size="sm"
              stacked
              label="Scheduled to publish"
              value={datetime(revision.scheduledPublishAt)}
            />
          ) : null}
        </PanelSection>
      </DetailsPanel>
    </>
  );
}

// A person in the rail, sized as its Owner row is.
function RailPerson({ id }: { id: string }) {
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
