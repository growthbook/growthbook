import { Box, IconButton } from "@radix-ui/themes";
import { date } from "shared/dates";
import { ExperimentTemplateInterface } from "shared/types/experiment";
import React, { useState } from "react";
import { omit } from "lodash";
import { useRouter } from "next/router";
import { isProjectListValidForProject } from "shared/util";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Trans, useLingui } from "@lingui/react/macro";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import SortedTags from "@/components/Tags/SortedTags";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useTemplates } from "@/hooks/useTemplates";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAddComputedFields, useSearch } from "@/services/search";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import EmptyState from "@/components/EmptyState";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import Callout from "@/ui/Callout";

function TemplateRowMenu({
  templateId,
  canEdit,
  canCreate,
  canDelete,
  onEdit,
  onDuplicate,
}: {
  templateId: string;
  canEdit: boolean;
  canCreate: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
}) {
  const { t } = useLingui();
  const [menuOpen, setMenuOpen] = useState(false);
  const { apiCall } = useAuth();
  const { mutateTemplates } = useTemplates();
  return (
    <DropdownMenu
      trigger={
        <IconButton
          variant="ghost"
          color="gray"
          radius="full"
          size="2"
          highContrast
        >
          <BsThreeDotsVertical size={18} />
        </IconButton>
      }
      open={menuOpen}
      onOpenChange={setMenuOpen}
      menuPlacement="end"
    >
      {canEdit && (
        <DropdownMenuItem
          onClick={() => {
            onEdit();
            setMenuOpen(false);
          }}
        >
          <Trans>Edit</Trans>
        </DropdownMenuItem>
      )}
      {canCreate && (
        <DropdownMenuItem
          onClick={() => {
            onDuplicate();
            setMenuOpen(false);
          }}
        >
          <Trans>Duplicate</Trans>
        </DropdownMenuItem>
      )}
      {canDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            color="red"
            confirmation={{
              submit: async () => {
                await apiCall(`/templates/${templateId}`, { method: "DELETE" });
                await mutateTemplates();
              },
              confirmationTitle: t`Delete Template`,
              cta: t`Delete`,
              ctaColor: "red",
              getConfirmationContent: async () =>
                t`Are you sure you want to delete this template? This action cannot be undone.`,
            }}
          >
            <Trans>Delete</Trans>
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenu>
  );
}

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
  const { t } = useLingui();
  const { ready, project, getProjectById } = useDefinitions();

  const { hasCommercialFeature } = useUser();
  const {
    templates: allTemplates,
    error,
    loading,
    templateExperimentMap,
  } = useTemplates();
  const permissionsUtil = usePermissionsUtil();
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
    ? allTemplates.filter((templ) =>
        isProjectListValidForProject(
          templ.project ? [templ.project] : [],
          project,
        ),
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

  const { items, SortableTableColumnHeader } = useSearch({
    items: flattenedTemplates,
    defaultSortField: "templateName",
    localStorageKey: "templates",
    searchFields: ["templateName^3", "tags", "templateDescription"],
  });

  const hasTemplates = items.length > 0;
  const showProjectColumn = items.some((templ) => !!templ.project);

  if (loading || !ready) {
    return <LoadingOverlay />;
  }

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }

  if (!hasTemplatesFeature) {
    return (
      <>
        <PremiumEmptyState
          title={t`Create Reusable Experiment Templates`}
          description={t`Save time configuring experiment details, and ensure consistency across your team and projects.`}
          commercialFeature="templates"
          learnMoreLink="https://docs.growthbook.io/running-experiments/experiment-templates"
        />
      </>
    );
  }
  return hasTemplates ? (
    <Box>
      <Table variant="list" stickyHeader roundedCorners>
        <TableHeader>
          <TableRow>
            <SortableTableColumnHeader field="templateName">
              <Trans>Template Name</Trans>
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="templateDescription">
              <Trans>Description</Trans>
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="tags">
              <Trans>Tags</Trans>
            </SortableTableColumnHeader>
            {showProjectColumn && (
              <SortableTableColumnHeader field="project">
                <Trans>Project</Trans>
              </SortableTableColumnHeader>
            )}
            <SortableTableColumnHeader field="dateCreated">
              <Trans>Created</Trans>
            </SortableTableColumnHeader>
            <SortableTableColumnHeader
              field="usage"
              style={{ textAlign: "right" }}
            >
              <Trans>Usage</Trans>
            </SortableTableColumnHeader>
            <TableColumnHeader style={{ width: 40 }} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((templ) => {
            const templateUsage = templ.usage;
            return (
              <TableRow
                key={templ.id}
                onClick={(e) => {
                  e.preventDefault();
                  router.push(`/experiments/template/${templ.id}`);
                }}
                style={{ cursor: "pointer" }}
              >
                <TableCell style={{ padding: "var(--space-0)" }}>
                  <Link
                    href={`/experiments/template/${templ.id}`}
                    style={{
                      display: "block",
                      padding: "var(--space-3)",
                      color: "var(--gray-12)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {templ.templateName}
                  </Link>
                </TableCell>
                <TableCell>{templ.templateDescription}</TableCell>
                <TableCell>
                  <SortedTags
                    tags={Object.values(templ.tags ?? [])}
                    useFlex={true}
                  />
                </TableCell>
                {showProjectColumn && (
                  <TableCell>
                    {templ.project ? getProjectById(templ.project)?.name : ""}
                  </TableCell>
                )}
                <TableCell>{date(templ.dateCreated)}</TableCell>
                <TableCell justify="end">
                  <Box pr="2">{templateUsage}</Box>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <TemplateRowMenu
                    templateId={templ.id}
                    canEdit={canEdit(templ)}
                    canCreate={canCreate}
                    canDelete={canDelete(templ)}
                    onEdit={() => setOpenTemplateModal(templ)}
                    onDuplicate={() => setOpenDuplicateTemplateModal(templ)}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  ) : (
    <EmptyState
      title={t`Create Reusable Experiment Templates`}
      description={t`Save time configuring experiment details, and ensure consistency across your team and projects.`}
      leftButton={
        <LinkButton
          href="https://docs.growthbook.io/running-experiments/experiment-templates"
          variant="outline"
          external={true}
        >
          <Trans>View docs</Trans>
        </LinkButton>
      }
      rightButton={
        <Button disabled={!canCreate} onClick={() => setOpenTemplateModal({})}>
          <Trans>Create Template</Trans>
        </Button>
      }
    ></EmptyState>
  );
};
