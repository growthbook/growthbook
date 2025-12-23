import { Box } from "@radix-ui/themes";
import { date } from "shared/dates";
import { ExperimentTemplateInterface } from "shared/types/experiment";
import React, { useState } from "react";
import { omit } from "lodash";
import { useRouter } from "next/router";
import { isProjectListValidForProject } from "shared/util";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import SortedTags from "@/components/Tags/SortedTags";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useTemplates } from "@/hooks/useTemplates";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAddComputedFields, useSearch } from "@/services/search";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import EmptyState from "@/components/EmptyState";

interface Props {
  setOpenTemplateModal: (
    template: Partial<ExperimentTemplateInterface>,
  ) => void;
  setOpenDuplicateTemplateModal: (
    template: ExperimentTemplateInterface,
  ) => void;
}

export const TemplatesPage = ({
  setOpenTemplateModal,
  setOpenDuplicateTemplateModal,
}: Props) => {
  const { ready, project, getProjectById } = useDefinitions();

  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const {
    templates: allTemplates,
    error,
    loading,
    templateExperimentMap,
    mutateTemplates,
  } = useTemplates();
  const permissionsUtil = usePermissionsUtil();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const router = useRouter();

  const hasTemplatesFeature = hasCommercialFeature("templates");
  const canCreate =
    permissionsUtil.canCreateExperimentTemplate({
      project: project,
    }) && hasTemplatesFeature;
  const canEdit = (templ: ExperimentTemplateInterface) =>
    permissionsUtil.canUpdateExperimentTemplate(templ, {}) &&
    hasTemplatesFeature;
  const canDelete = (templ: ExperimentTemplateInterface) =>
    permissionsUtil.canDeleteExperimentTemplate(templ);

  const filteredTemplates = project
    ? allTemplates.filter((t) =>
        isProjectListValidForProject(t.project ? [t.project] : [], project),
      )
    : allTemplates;

  const flattenedTemplates = useAddComputedFields(
    filteredTemplates,
    (templ) => {
      return {
        ...omit(allTemplates, ["templateMetadata"]),
        templateName: templ.templateMetadata.name,
        templateDescription: templ.templateMetadata.description,
        usage: templateExperimentMap[templ.id]?.length ?? 0,
      };
    },
    [templateExperimentMap, allTemplates],
  );

  const { items, SortableTH } = useSearch({
    items: flattenedTemplates,
    defaultSortField: "templateName",
    localStorageKey: "templates",
    searchFields: ["templateName^3", "tags", "templateDescription"],
  });

  const hasTemplates = items.length > 0;
  const showProjectColumn = items.some((t) => !!t.project);

  if (loading || !ready) {
    return <LoadingOverlay />;
  }

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }

  if (!hasTemplatesFeature) {
    return (
      <>
        <PremiumEmptyState
          title="Create Reusable Experiment Templates"
          description="Save time configuring experiment details, and ensure consistency
            across your team and projects."
          commercialFeature="templates"
          learnMoreLink="https://docs.growthbook.io/running-experiments/experiment-templates"
        />
      </>
    );
  }
  return hasTemplates ? (
    <Box>
      <table className="appbox table gbtable">
        <thead>
          <tr>
            <SortableTH field="templateName">Template Name</SortableTH>
            <SortableTH field="templateDescription">Description</SortableTH>
            <SortableTH field="tags">Tags</SortableTH>
            {showProjectColumn && (
              <SortableTH field="project">Project</SortableTH>
            )}
            <SortableTH field="dateCreated">Created</SortableTH>
            <SortableTH field="usage">Usage</SortableTH>
            <th style={{ width: 50 }} />
          </tr>
        </thead>
        <tbody>
          {items.map((t) => {
            const templateUsage = t.usage;
            return (
              <tr
                key={t.id}
                className="hover-highlight"
                onClick={(e) => {
                  e.preventDefault();
                  router.push(`/experiments/template/${t.id}`);
                }}
                style={{ cursor: "pointer" }}
              >
                <td data-title="Template Name" className="col-2">
                  <Link href={`/experiments/template/${t.id}`}>
                    {t.templateName}
                  </Link>
                </td>
                <td data-title="Description" className="col-3">
                  {t.templateDescription}
                </td>
                <td data-title="Tags">
                  <SortedTags
                    tags={Object.values(t.tags ?? [])}
                    useFlex={true}
                  />
                </td>
                {showProjectColumn && (
                  <td className="text-gray col-2">
                    {t.project ? getProjectById(t.project)?.name : ""}
                  </td>
                )}
                <td data-title="Created" className="col-2">
                  {date(t.dateCreated)}
                </td>
                <td data-title="Usage">{templateUsage}</td>
                <td
                  // style={{ cursor: "initial" }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <MoreMenu>
                    {canEdit(t) ? (
                      <button
                        className="dropdown-item"
                        onClick={() => {
                          setOpenTemplateModal(t);
                        }}
                      >
                        Edit
                      </button>
                    ) : null}
                    {canCreate ? (
                      <button
                        className="dropdown-item"
                        onClick={() => {
                          setOpenDuplicateTemplateModal(t);
                        }}
                      >
                        Duplicate
                      </button>
                    ) : null}
                    <hr className="my-1" />
                    {canDelete(t) ? (
                      <DeleteButton
                        className="dropdown-item text-danger"
                        displayName="Template"
                        text="Delete"
                        useIcon={false}
                        onClick={async () => {
                          await apiCall(`/templates/${t.id}`, {
                            method: "DELETE",
                          });
                          await mutateTemplates();
                        }}
                      />
                    ) : null}
                  </MoreMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Box>
  ) : (
    <>
      {showUpgradeModal && (
        <UpgradeModal
          close={() => setShowUpgradeModal(false)}
          source="templates"
          commercialFeature="templates"
        />
      )}
      <EmptyState
        title="Create Reusable Experiment Templates"
        description="Save time configuring experiment details, and ensure consistency
          across your team and projects."
        leftButton={
          <LinkButton
            href="https://docs.growthbook.io/running-experiments/experiment-templates"
            variant="outline"
            external={true}
          >
            View docs
          </LinkButton>
        }
        rightButton={
          canCreate ? (
            <Button onClick={() => setOpenTemplateModal({})}>
              Create Template
            </Button>
          ) : (
            <Button
              onClick={() => {
                setShowUpgradeModal(true);
              }}
            >
              Upgrade Plan
            </Button>
          )
        }
      ></EmptyState>
    </>
  );
};
