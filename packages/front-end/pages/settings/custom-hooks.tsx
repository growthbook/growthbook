import React, { useState } from "react";
import { CustomHookInterface } from "shared/validators";
import { Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import useApi from "@/hooks/useApi";
import Callout from "@/ui/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import EmptyState from "@/components/EmptyState";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { isCloud } from "@/services/env";
import CustomHookModal from "@/components/Features/CustomHookModal";

export default function CustomHooksPage() {
  const [modalData, setModalData] = useState<null | true | CustomHookInterface>(
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
  // Global/project hooks are managed here. Feature-scoped hooks are managed
  // from each feature's Validation tab and shown read-only below.
  const hooks = allHooks.filter((h) => !h.entityType);
  const featureHooks = allHooks.filter((h) => h.entityType === "feature");

  return (
    <div className="container-fluid pagecontents">
      {modalData && (
        <CustomHookModal
          current={modalData === true ? undefined : modalData}
          close={() => setModalData(null)}
          onSave={() => mutate()}
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
            <Flex justify="between" align="center" mb="3">
              <h1 className="mb-0">Custom Hooks</h1>
              <Button onClick={() => setModalData(true)}>
                Add Custom Hook
              </Button>
            </Flex>
            {hooks.length === 0 ? (
              <Callout status="info">
                No global or project-scoped hooks yet.
              </Callout>
            ) : (
              <table className="gbtable table appbox">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Projects</th>
                    <th>Enabled</th>
                    <th style={{ width: 50 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {hooks.map((hook) => (
                    <tr key={hook.id}>
                      <td data-title="Name">{hook.name}</td>
                      <td data-title="Type">{hook.hook}</td>
                      <td data-title="Projects">{hook.projects.join(", ")}</td>
                      <td data-title="Enabled">
                        {hook.enabled ? "Yes" : "No"}
                      </td>
                      <td>
                        <MoreMenu>
                          <a
                            href="#"
                            className="dropdown-item"
                            onClick={() => setModalData(hook)}
                          >
                            Edit
                          </a>
                          <DeleteButton
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {featureHooks.length > 0 && (
            <div className="mt-5">
              <h2>Feature-specific Hooks</h2>
              <p className="text-muted">
                These hooks are scoped to a single feature and managed from that
                feature&apos;s Validation tab.
              </p>
              <table className="gbtable table appbox">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Feature</th>
                    <th>Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {featureHooks.map((hook) => (
                    <tr key={hook.id}>
                      <td data-title="Name">{hook.name}</td>
                      <td data-title="Type">{hook.hook}</td>
                      <td data-title="Feature">
                        <a href={`/features/${hook.entityId}#validation`}>
                          {hook.entityId}
                        </a>
                      </td>
                      <td data-title="Enabled">
                        {hook.enabled ? "Yes" : "No"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
