import { Box, Text, Tooltip } from "@radix-ui/themes";
import { date } from "shared/dates";
import { ExperimentTemplateInterface } from "back-end/types/experiment";
import { useState } from "react";
import { omit } from "lodash";
import Link from "@/components/Radix/Link";
import Button from "@/components/Radix/Button";
import LinkButton from "@/components/Radix/LinkButton";
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

export const TemplatesPage = ({
  setOpenTemplateModal,
  setOpenDuplicateTemplateModal,
}) => {
  const { ready, project, getProjectById } = useDefinitions();

  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const {
    templates: allTemplates,
    error,
    loading,
    templateExperimentMap,
    mutateTemplates,
  } = useTemplates(project);
  const permissionsUtil = usePermissionsUtil();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const hasTemplatesFeature = hasCommercialFeature("templates");
  const canCreate = permissionsUtil.canCreateExperimentTemplate({
    project: project,
  });
  const canEdit = (templ: ExperimentTemplateInterface) =>
    permissionsUtil.canUpdateExperimentTemplate(templ, {});
  const canDelete = (templ: ExperimentTemplateInterface) =>
    permissionsUtil.canDeleteExperimentTemplate(templ);

  const flattenedTemplates = useAddComputedFields(
    allTemplates,
    (templ) => {
      return {
        ...omit(allTemplates, ["templateMetadata"]),
        templateName: templ.templateMetadata.name,
        templateDescription: templ.templateMetadata.description,
        usage: templateExperimentMap[templ.id]?.length ?? 0,
      };
    },
    []
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

  return hasTemplates ? (
    <Box>
      <table className="appbox table gbtable table-hover">
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
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((t) => {
            const templateUsage = t.usage;
            return (
              <tr key={t.id} className="hover-highlight">
                <td data-title="Template Name" className="col-2">
                  {templateUsage ? (
                    <Link href={`/experiments/template/${t.id}`}>
                      {t.templateName}
                    </Link>
                  ) : (
                    <Tooltip content="This template hasn’t been used to create any experiments yet">
                      <Text>{t.templateName}</Text>
                    </Tooltip>
                  )}
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
                <td className="text-gray col-2">
                  {t.project ? getProjectById(t.project)?.name : ""}
                </td>
                <td data-title="Created" className="col-2">
                  {date(t.dateCreated)}
                </td>
                <td data-title="Usage">{templateUsage}</td>
                <td>
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
                    <hr />
                    {canDelete(t) ? (
                      <DeleteButton
                        className="dropdown-item"
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
          reason="Create reusable experiment templates"
        />
      )}
      <div className="appbox p-5 text-center">
        <h1>Create Reusable Experiment Templates</h1>
        <Text size="3">
          Save time configuring experiment details, and ensure consistency
          across your team and projects.
        </Text>
        <div className="mt-3">
          {/* TODO: Fix docs link once docs are ready */}
          <LinkButton
            href="https://docs.growthbook.io/"
            variant="outline"
            mr="3"
            external={true}
          >
            View docs
          </LinkButton>
          {hasTemplatesFeature ? (
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
          )}
        </div>
      </div>
    </>
  );
};
