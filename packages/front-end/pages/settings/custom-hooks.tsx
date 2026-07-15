import React, { useState } from "react";
import { CustomHookInterface } from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import useApi from "@/hooks/useApi";
import Callout from "@/ui/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import EmptyState from "@/components/EmptyState";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { isCloud } from "@/services/env";
import CustomHookModal, {
  hookTypes,
} from "@/components/CustomHooks/CustomHookModal";
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

export default function CustomHooksPage() {
  const [modalData, setModalData] = useState<null | true | CustomHookInterface>(
    null,
  );
  const [viewCodeHook, setViewCodeHook] = useState<CustomHookInterface | null>(
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
  // Global/project hooks managed here; feature-scoped ones on the feature's Validation tab.
  const hooks = allHooks.filter((h) => !h.entityType);
  const featureHooks = allHooks.filter((h) => h.entityType === "feature");
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
                        {hook.name}
                        {!hook.enabled ? (
                          <Badge color="gray" label="Disabled" />
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
                          <a
                            href="#"
                            className="dropdown-item"
                            onClick={(e) => {
                              e.preventDefault();
                              setModalData(hook);
                            }}
                          >
                            Edit
                          </a>
                          <a
                            href="#"
                            className="dropdown-item"
                            onClick={async (e) => {
                              e.preventDefault();
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
            )}
          </div>

          {featureHooks.length > 0 && (
            <div className="mt-5">
              <h2>Feature-specific Hooks</h2>
              <p className="text-muted">
                These hooks are scoped to a single feature and managed from that
                feature&apos;s Validation tab.
              </p>
              <Table variant="list" stickyHeader roundedCorners>
                <TableHeader>
                  <TableRow>
                    <TableColumnHeader>Name</TableColumnHeader>
                    <TableColumnHeader>Type</TableColumnHeader>
                    <TableColumnHeader>Feature</TableColumnHeader>
                    <TableColumnHeader style={{ width: 50 }} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {featureHooks.map((hook) => (
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
                        <Link href={`/features/${hook.entityId}#validation`}>
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
                        </MoreMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {experimentHooks.length > 0 && (
            <div className="mt-5">
              <h2>Experiment-specific Hooks</h2>
              <p className="text-muted">
                These hooks are scoped to a single experiment and managed from
                that experiment&apos;s Setup tab.
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
