import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { useRouter } from "next/router";
import { EXPERIMENT_QUALITY_SECTIONS } from "shared/enterprise";
import {
  ExperimentationHealthSettingsInterface,
  experimentQualitySectionKeys,
} from "shared/validators";
import { date } from "shared/dates";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import {
  DropdownMenu,
  DropdownMenuItem,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import AddOverrideModal from "./AddOverrideModal";
import {
  QualityConfigDraft,
  areWeightsChanged,
  configToDraft,
  isSectionChanged,
} from "./qualityConfigDraft";

// What a Project's record changes from the organization default
function overriddenParts(
  record: ExperimentationHealthSettingsInterface,
  orgDraft: QualityConfigDraft,
  orgEnabled: boolean,
): string[] {
  const parts: string[] = [];
  const enabled = record.quality?.enabled;
  if (enabled !== undefined && enabled !== orgEnabled) parts.push("Scoring");
  if (record.quality?.config) {
    const draft = configToDraft(record.quality.config);
    if (areWeightsChanged(draft, orgDraft)) parts.push("Weights");
    experimentQualitySectionKeys.forEach((k) => {
      if (isSectionChanged(draft, orgDraft, k)) {
        parts.push(EXPERIMENT_QUALITY_SECTIONS[k].label);
      }
    });
  }
  return parts;
}

export default function ProjectOverridesTab({
  overrides,
  orgDraft,
  orgEnabled,
  experimentsByProject,
}: {
  overrides: ExperimentationHealthSettingsInterface[];
  orgDraft: QualityConfigDraft;
  orgEnabled: boolean;
  experimentsByProject: Record<string, number>;
}) {
  const router = useRouter();
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { getProjectById, mutateDefinitions } = useDefinitions();
  const [adding, setAdding] = useState<{ copyFrom: string | null } | null>(
    null,
  );
  const pageFor = (project: string) =>
    `/settings/experiment-quality/${encodeURIComponent(project)}`;

  return (
    <>
      {adding ? (
        <AddOverrideModal
          copyFrom={adding.copyFrom}
          overriddenProjects={overrides.map((r) => r.project)}
          close={() => setAdding(null)}
        />
      ) : null}
      <Flex justify="between" align="center" mb="4" gap="3">
        <Text color="text-mid">
          A Project with an override uses its own settings for the sections that
          differ.
        </Text>
        <Button onClick={() => setAdding({ copyFrom: null })}>
          Add override
        </Button>
      </Flex>
      {overrides.length ? (
        <Table variant="list">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Project</TableColumnHeader>
              <TableColumnHeader>Overridden sections</TableColumnHeader>
              <TableColumnHeader justify="end">Experiments</TableColumnHeader>
              <TableColumnHeader>Last edited</TableColumnHeader>
              <TableColumnHeader />
            </TableRow>
          </TableHeader>
          <TableBody>
            {overrides.map((record) => {
              const canEdit = permissionsUtil.canUpdateProject(record.project);
              return (
                <TableRow key={record.project}>
                  <TableCell>
                    {canEdit ? (
                      <Link href={pageFor(record.project)}>
                        {getProjectById(record.project)?.name ?? record.project}
                      </Link>
                    ) : (
                      (getProjectById(record.project)?.name ?? record.project)
                    )}
                  </TableCell>
                  <TableCell>
                    <Flex gap="1" wrap="wrap">
                      {overriddenParts(record, orgDraft, orgEnabled).map(
                        (part) => (
                          <Badge
                            key={part}
                            label={part}
                            color="gray"
                            variant="soft"
                          />
                        ),
                      )}
                    </Flex>
                  </TableCell>
                  <TableCell justify="end">
                    {experimentsByProject[record.project] ?? 0}
                  </TableCell>
                  <TableCell>{date(record.dateUpdated)}</TableCell>
                  <TableCell justify="end">
                    {canEdit ? (
                      <DropdownMenu
                        trigger={<MoreMenuTrigger label="More actions" />}
                        menuPlacement="end"
                      >
                        <DropdownMenuItem
                          onClick={async () => {
                            await router.push(pageFor(record.project));
                          }}
                        >
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            setAdding({ copyFrom: record.project })
                          }
                        >
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          color="red"
                          confirmation={{
                            confirmationTitle: "Delete Override",
                            cta: "Delete",
                            ctaColor: "red",
                            getConfirmationContent: async () =>
                              `${getProjectById(record.project)?.name ?? "This Project"} will follow the organization default.`,
                            submit: async () => {
                              await apiCall(
                                `/experimentation-health/settings?project=${encodeURIComponent(record.project)}`,
                                { method: "DELETE" },
                              );
                              await mutateDefinitions();
                            },
                          }}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <Text as="p" color="text-mid">
          No Project overrides yet. Every Project uses the organization default.
        </Text>
      )}
    </>
  );
}
