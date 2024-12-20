import { Box, Text, Tooltip } from "@radix-ui/themes";
import { date } from "shared/dates";
import { ExperimentTemplateInterface } from "back-end/types/experiment";
import { useState } from "react";
import { useRouter } from "next/router";
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

export const TemplatesPage = ({
  setOpenTemplateModal,
  setOpenDuplicateTemplateModal,
}) => {
  const { ready, project, getProjectById } = useDefinitions();
  const router = useRouter();

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
    projects: [project],
  });
  const canEdit = (templ: ExperimentTemplateInterface) =>
    permissionsUtil.canUpdateExperimentTemplate(templ, {});
  const canDelete = (templ: ExperimentTemplateInterface) =>
    permissionsUtil.canDeleteExperimentTemplate(templ);

  const hasTemplates = allTemplates.length > 0;
  const showProjectColumn = true;

  if (loading || !ready) {
    return <LoadingOverlay />;
  }

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }

  return hasTemplates ? (
    <Box>
      <table className="appbox table gbtable responsive-table">
        <thead>
          <tr>
            <th>Template Name</th>
            <th className="w-100">Description</th>
            <th>Tags</th>
            {showProjectColumn && <th>Projects</th>}
            <th>Created</th>
            <th>Usage</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {allTemplates.map((t) => {
            const templateUsage = templateExperimentMap[t.id]?.length ?? 0;
            return (
              <tr
                key={t.id}
                className="hover-highlight"
                onClick={(e) => {
                  e.preventDefault();
                  if (!templateUsage) return;
                  router.push(`/experiments/template/${t.id}`);
                }}
              >
                <td data-title="Template Name">
                  {templateUsage ? (
                    <Link href={`/experiments/template/${t.id}`}>
                      {t.templateMetadata.name}
                    </Link>
                  ) : (
                    <Tooltip content="This template hasn’t been used to create any experiments yet">
                      <Text>{t.templateMetadata.name}</Text>
                    </Tooltip>
                  )}
                </td>
                <td data-title="Description">
                  {t.templateMetadata.description}
                </td>
                <td data-title="Tags" className="table-tags">
                  <SortedTags
                    tags={Object.values(t.templateMetadata.tags ?? [])}
                    useFlex={true}
                  />
                </td>
                <td className="text-gray">
                  {t.projects && (
                    <>
                      {t.projects
                        .map((p) => {
                          return getProjectById(p)?.name || "";
                        })
                        ?.join(", ")}
                    </>
                  )}
                </td>
                <td data-title="Created">{date(t.dateCreated)}</td>
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
