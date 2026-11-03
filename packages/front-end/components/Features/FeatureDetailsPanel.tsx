import { useState } from "react";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { HoldoutInterface } from "shared/validators";
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
import EditFeatureInfoModal, {
  FeatureInfoSection,
  SECTION_HEADERS,
} from "@/components/Features/EditFeatureInfoModal";
import FeatureValueTypeDisplay from "@/components/Features/FeatureValueTypeDisplay";
import { useDefinitions } from "@/services/DefinitionsContext";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

export default function FeatureDetailsPanel({
  feature,
  baseFeature,
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
  revisionList: MinimalFeatureRevisionInterface[];
  holdout: HoldoutInterface | undefined;
  dependents: number;
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

  const { projects, getProjectById } = useDefinitions();
  const targetingProjects = feature.targetingProjects ?? [];

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
          dependents={dependents}
          cancel={() => setInfoSection(null)}
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
      </DetailsPanel>
    </>
  );
}
