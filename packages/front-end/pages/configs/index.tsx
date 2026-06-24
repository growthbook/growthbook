import React, { useMemo, useState } from "react";
import { date } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
import { ConstantWithoutValue } from "shared/types/constant";
import { isProjectListValidForProject } from "shared/util";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import EmptyState from "@/components/EmptyState";
import ProjectBadges from "@/components/ProjectBadges";
import ConfigModal from "@/components/Constants/ConfigModal";
import { useAddComputedFields, useSearch } from "@/services/search";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

// Configs are `config`-type constants (a JSON object + field schema) edited
// through the dedicated Configuration UI. This list mirrors the Constants list
// but filters to config types. (First cut — the full draft/review tabs from the
// Constants list can be brought over as the detail page matures.)
export default function ConfigsPage(): React.ReactElement {
  const { ready, project, projects, constants } = useDefinitions();
  const { getOwnerDisplay } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const visibleConfigs = useMemo(
    () =>
      constants.filter(
        (c) =>
          c.type === "config" &&
          !c.archived &&
          isProjectListValidForProject(c.project ? [c.project] : [], project),
      ),
    [constants, project],
  );

  const configItems = useAddComputedFields(visibleConfigs, (c) => ({
    ownerName: getOwnerDisplay(c.owner) || "",
    projectNames: c.project
      ? [projects.find((p) => p.id === c.project)?.name ?? c.project]
      : [],
  }));

  const { items, searchInputProps, SortableTableColumnHeader } = useSearch({
    items: configItems,
    searchFields: ["name^3", "key^2", "description^2", "ownerName"],
    localStorageKey: "configs",
    defaultSortField: "name",
    defaultSortDir: 1,
  });

  const [showCreate, setShowCreate] = useState(false);

  if (!ready) {
    return <LoadingOverlay />;
  }

  const canAdd = permissionsUtil.canCreateConstant({
    project: project || undefined,
  });
  const hasConfigs = visibleConfigs.length > 0;

  return (
    <Box className="contents container-fluid pagecontents" mb="3" mt="2">
      <Flex align="center" justify="between" mb="3" mt="2">
        <Heading as="h1" size="2x-large">
          Configs
        </Heading>
        {hasConfigs && canAdd && (
          <Button onClick={() => setShowCreate(true)}>New config</Button>
        )}
      </Flex>
      <Text as="p" mb="3" color="text-mid">
        Strongly-typed configuration objects with a base config and field-level
        overrides, composed and delivered through your feature flags.
      </Text>
      <Callout status="info" mb="3">
        A config isn&apos;t a standalone object in your SDK payload — it&apos;s
        instantiated by a feature flag. Build the config here, then reference it
        from a flag value to deliver it.
      </Callout>

      {!hasConfigs ? (
        <EmptyState
          title="Typed, composable configuration"
          description="Define a base config with a field schema, then create override configs that inherit and override specific fields."
          leftButton={
            <LinkButton
              href="https://docs.growthbook.io/features/constants"
              variant="outline"
              external={true}
            >
              View docs
            </LinkButton>
          }
          rightButton={
            canAdd ? (
              <Button onClick={() => setShowCreate(true)}>New config</Button>
            ) : null
          }
        />
      ) : (
        <>
          <Box mb="3" style={{ maxWidth: 400 }}>
            <Field
              placeholder="Search configs..."
              type="search"
              {...searchInputProps}
            />
          </Box>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableColumnHeader field="name">
                  Name
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="key">
                  Key
                </SortableTableColumnHeader>
                <TableColumnHeader>Projects</TableColumnHeader>
                <SortableTableColumnHeader field="ownerName">
                  Owner
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="dateUpdated">
                  Last updated
                </SortableTableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c: ConstantWithoutValue & { ownerName: string }) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/configs/${c.key}`} color="dark">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell>{c.key}</TableCell>
                  <TableCell>
                    <ProjectBadges
                      projectIds={c.project ? [c.project] : []}
                      resourceType="constant"
                    />
                  </TableCell>
                  <TableCell>{c.ownerName}</TableCell>
                  <TableCell>
                    {c.dateUpdated ? date(c.dateUpdated) : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
      {showCreate && <ConfigModal close={() => setShowCreate(false)} />}
    </Box>
  );
}
