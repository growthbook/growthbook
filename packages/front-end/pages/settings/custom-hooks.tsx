import React, { useState } from "react";
import { CustomHookInterface } from "shared/validators";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import useApi from "@/hooks/useApi";
import Callout from "@/ui/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import EmptyState from "@/components/EmptyState";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { isCloud } from "@/services/env";
import CustomHookModal, {
  hookTypes,
} from "@/components/CustomHooks/CustomHookModal";
import CompareCustomHookEventsModal from "@/components/Features/CompareCustomHookEventsModal";
import CustomHookCodeModal from "@/components/CustomHooks/CustomHookCodeModal";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";

// Feature- and config-scoped hooks render identical tables, differing only in
// their labels and the entity link target.
function EntityScopedHooksSection({
  title,
  description,
  entityLabel,
  entityHref,
  hooks,
  onViewCode,
  onHistory,
}: {
  title: string;
  description: string;
  entityLabel: string;
  entityHref: (hook: CustomHookInterface) => string;
  hooks: CustomHookInterface[];
  onViewCode: (hook: CustomHookInterface) => void;
  onHistory: (hook: CustomHookInterface) => void;
}) {
  if (!hooks.length) return null;
  return (
    <div className="mt-5">
      <h2>{title}</h2>
      <p className="text-muted">{description}</p>
      <Table variant="list" stickyHeader roundedCorners>
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Name</TableColumnHeader>
            <TableColumnHeader>Type</TableColumnHeader>
            <TableColumnHeader>{entityLabel}</TableColumnHeader>
            <TableColumnHeader style={{ width: 50 }} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {hooks.map((hook) => (
            <TableRow key={hook.id}>
              <TableCell>
                <Link onClick={() => onViewCode(hook)}>{hook.name}</Link>
                {!hook.enabled ? (
                  <Badge color="gray" label="Disabled" ml="2" />
                ) : null}
              </TableCell>
              <TableCell>{hookTypes[hook.hook]?.label ?? hook.hook}</TableCell>
              <TableCell>
                <Link href={entityHref(hook)}>{hook.entityId}</Link>
              </TableCell>
              <TableCell>
                <DropdownMenu
                  variant="soft"
                  trigger={
                    <IconButton
                      variant="ghost"
                      color="gray"
                      radius="full"
                      size="1"
                      highContrast
                    >
                      <BsThreeDotsVertical size={16} />
                    </IconButton>
                  }
                  menuPlacement="end"
                >
                  <DropdownMenuItem onClick={() => onHistory(hook)}>
                    History &amp; revert
                  </DropdownMenuItem>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function CustomHooksPage() {
  const [modalData, setModalData] = useState<null | true | CustomHookInterface>(
    null,
  );
  const [viewCodeHook, setViewCodeHook] = useState<CustomHookInterface | null>(
    null,
  );
  const [historyHook, setHistoryHook] = useState<CustomHookInterface | null>(
    null,
  );

  const { apiCall } = useAuth();

  const { data, error, mutate } = useApi<{
    customHooks: CustomHookInterface[];
  }>("/custom-hooks");

  if (isCloud()) {
    return (
      <Callout status="error">
        Custom Hooks are not available on GrowthBook Cloud.
      </Callout>
    );
  }

  if (error) {
    return <Callout status="error">Error: {error.message}</Callout>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const allHooks = data.customHooks || [];
  // Global/project hooks managed here; entity-scoped ones on the resource's Validation tab.
  const hooks = allHooks.filter((h) => !h.entityType);
  const featureHooks = allHooks.filter((h) => h.entityType === "feature");
  const configHooks = allHooks.filter((h) => h.entityType === "config");
  const experimentHooks = allHooks.filter((h) => h.entityType === "experiment");

  return (
    <div className="container-fluid pagecontents">
      {modalData && (
        <CustomHookModal
          current={modalData === true ? undefined : modalData}
          close={() => setModalData(null)}
          onSave={() => mutate()}
        />
      )}
      {viewCodeHook && (
        <CustomHookCodeModal
          hook={viewCodeHook}
          close={() => setViewCodeHook(null)}
        />
      )}
      {historyHook && (
        <CompareCustomHookEventsModal
          hook={historyHook}
          canRevert={!historyHook.entityType}
          onClose={() => setHistoryHook(null)}
          onRevert={() => mutate()}
        />
      )}

      {allHooks.length === 0 ? (
        <EmptyState
          description="Custom hooks allow you to extend the functionality of GrowthBook by
        writing custom javascript snippets that execute on certain events."
          title="Custom Hooks"
          // TODO: add docs page and link to it here
          leftButton={null}
          rightButton={
            <Button onClick={() => setModalData(true)}>Add Custom Hook</Button>
          }
        />
      ) : (
        <>
          <div>
            <Box mb="5">
              <h1>Custom Hooks</h1>
              <p>
                Custom hooks allow you to extend the functionality of GrowthBook
                by writing custom javascript snippets that execute on certain
                events.
              </p>
            </Box>
            <Flex justify="between" align="center" mb="1">
              <h2 className="mb-0">Global/Project Hooks</h2>
              <Button onClick={() => setModalData(true)}>
                Add Custom Hook
              </Button>
            </Flex>

            <p className="text-muted">
              These hooks run for all resources in your organization.
            </p>

            {hooks.length === 0 ? (
              <Callout status="info">
                No global or project-scoped hooks yet.
              </Callout>
            ) : (
              <Table variant="list" stickyHeader roundedCorners>
                <TableHeader>
                  <TableRow>
                    <TableColumnHeader>Name</TableColumnHeader>
                    <TableColumnHeader>Type</TableColumnHeader>
                    <TableColumnHeader>Projects</TableColumnHeader>
                    <TableColumnHeader style={{ width: 50 }} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hooks.map((hook) => (
                    <TableRow key={hook.id}>
                      <TableCell>
                        <Link onClick={() => setViewCodeHook(hook)}>
                          {hook.name}
                        </Link>
                        {!hook.enabled ? (
                          <Badge color="gray" label="Disabled" ml="2" />
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {hookTypes[hook.hook]?.label ?? hook.hook}
                      </TableCell>
                      <TableCell>
                        {hook.projects.length ? (
                          hook.projects.join(", ")
                        ) : (
                          <em>All Projects</em>
                        )}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu
                          variant="soft"
                          trigger={
                            <IconButton
                              variant="ghost"
                              color="gray"
                              radius="full"
                              size="1"
                              highContrast
                            >
                              <BsThreeDotsVertical size={16} />
                            </IconButton>
                          }
                          menuPlacement="end"
                        >
                          <DropdownMenuItem onClick={() => setModalData(hook)}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setHistoryHook(hook)}
                          >
                            History &amp; revert
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={async () => {
                              await apiCall(`/custom-hooks/${hook.id}`, {
                                method: "PUT",
                                body: JSON.stringify({
                                  enabled: !hook.enabled,
                                }),
                              });
                              await mutate();
                            }}
                          >
                            {hook.enabled ? "Disable" : "Enable"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            color="red"
                            confirmation={{
                              submit: async () => {
                                await apiCall(`/custom-hooks/${hook.id}`, {
                                  method: "DELETE",
                                });
                                await mutate();
                              },
                              confirmationTitle: "Delete custom hook",
                              cta: "Delete",
                              getConfirmationContent: async () =>
                                "Are you sure? This action cannot be undone.",
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <EntityScopedHooksSection
            title="Feature-specific Hooks"
            description="These hooks are scoped to a single feature and managed from that feature's Validation tab."
            entityLabel="Feature"
            entityHref={(hook) => `/features/${hook.entityId}#validation`}
            hooks={featureHooks}
            onViewCode={setViewCodeHook}
            onHistory={setHistoryHook}
          />

          <EntityScopedHooksSection
            title="Config-specific Hooks"
            description="These hooks are scoped to a single config and managed from that config's Validation tab."
            entityLabel="Config"
            entityHref={(hook) => `/configs/${hook.entityId}#validation`}
            hooks={configHooks}
            onViewCode={setViewCodeHook}
            onHistory={setHistoryHook}
          />

          {experimentHooks.length > 0 && (
            <div className="mt-5">
              <h2>Experiment-specific Hooks</h2>
              <p className="text-muted">
                These hooks are scoped to a single experiment. Experiment hooks
                are now managed as global hooks above; you can remove any
                leftover scoped hooks here.
              </p>
              <Table variant="list" stickyHeader roundedCorners>
                <TableHeader>
                  <TableRow>
                    <TableColumnHeader>Name</TableColumnHeader>
                    <TableColumnHeader>Type</TableColumnHeader>
                    <TableColumnHeader>Experiment</TableColumnHeader>
                    <TableColumnHeader style={{ width: 50 }} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {experimentHooks.map((hook) => (
                    <TableRow key={hook.id}>
                      <TableCell>
                        {hook.name}
                        {!hook.enabled ? (
                          <Badge color="gray" label="Disabled" />
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {hookTypes[hook.hook]?.label ?? hook.hook}
                      </TableCell>
                      <TableCell>
                        <Link href={`/experiment/${hook.entityId}`}>
                          {hook.entityId}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <MoreMenu iconButtonSize="1">
                          <a
                            href="#"
                            className="dropdown-item"
                            onClick={(e) => {
                              e.preventDefault();
                              setViewCodeHook(hook);
                            }}
                          >
                            Preview Code
                          </a>
                          <DeleteButton
                            useRadix={false}
                            useIcon={false}
                            text="Delete"
                            displayName="custom hook"
                            onClick={async () => {
                              await apiCall(`/custom-hooks/${hook.id}`, {
                                method: "DELETE",
                              });
                              await mutate();
                            }}
                            className="dropdown-item text-danger"
                          />
                        </MoreMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
