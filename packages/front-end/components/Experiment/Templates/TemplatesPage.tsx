import { Box, IconButton } from "@radix-ui/themes";
import { date } from "shared/dates";
import { ExperimentTemplateInterface } from "shared/types/experiment";
import React, { useState } from "react";
import { omit } from "lodash";
import { useRouter } from "next/router";
import { isProjectListValidForProject } from "shared/util";
import { BsThreeDotsVertical } from "react-icons/bs";
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
          Edit
        </DropdownMenuItem>
      )}
      {canCreate && (
        <DropdownMenuItem
          onClick={() => {
            onDuplicate();
            setMenuOpen(false);
          }}
        >
          Duplicate
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
              confirmationTitle: "Delete Template",
              cta: "Delete",
              ctaColor: "red",
              getConfirmationContent: async () =>
                "Are you sure you want to delete this template? This action cannot be undone.",
            }}
          >
            Delete
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

  const { items, SortableTableColumnHeader } = useSearch({
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
    return <Callout status="error">{error.message}</Callout>;
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
      <Table variant="list" stickyHeader roundedCorners>
        <TableHeader>
          <TableRow>
            <SortableTableColumnHeader field="templateName">
              Template Name
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="templateDescription">
              Description
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="tags">
              Tags
            </SortableTableColumnHeader>
            {showProjectColumn && (
              <SortableTableColumnHeader field="project">
                Project
              </SortableTableColumnHeader>
            )}
            <SortableTableColumnHeader field="dateCreated">
              Created
            </SortableTableColumnHeader>
            <SortableTableColumnHeader
              field="usage"
              style={{ textAlign: "right" }}
            >
              Usage
            </SortableTableColumnHeader>
            <TableColumnHeader style={{ width: 40 }} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((t) => {
            const templateUsage = t.usage;
            return (
              <TableRow
                key={t.id}
                onClick={(e) => {
                  e.preventDefault();
                  router.push(`/experiments/template/${t.id}`);
                }}
                style={{ cursor: "pointer" }}
              >
                <TableCell style={{ padding: "var(--space-0)" }}>
                  <Link
                    href={`/experiments/template/${t.id}`}
                    style={{
                      display: "block",
                      padding: "var(--space-3)",
                      color: "var(--gray-12)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t.templateName}
                  </Link>
                </TableCell>
                <TableCell>{t.templateDescription}</TableCell>
                <TableCell>
                  <SortedTags
                    tags={Object.values(t.tags ?? [])}
                    useFlex={true}
                  />
                </TableCell>
                {showProjectColumn && (
                  <TableCell>
                    {t.project ? getProjectById(t.project)?.name : ""}
                  </TableCell>
                )}
                <TableCell>{date(t.dateCreated)}</TableCell>
                <TableCell justify="end">
                  <Box pr="2">{templateUsage}</Box>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <TemplateRowMenu
                    templateId={t.id}
                    canEdit={canEdit(t)}
                    canCreate={canCreate}
                    canDelete={canDelete(t)}
                    onEdit={() => setOpenTemplateModal(t)}
                    onDuplicate={() => setOpenDuplicateTemplateModal(t)}
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
        <Button disabled={!canCreate} onClick={() => setOpenTemplateModal({})}>
          Create Template
        </Button>
      }
    ></EmptyState>
  );
};
