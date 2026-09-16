import React, { useState } from "react";
import { CustomHookInterface } from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import useApi from "@/hooks/useApi";
import Callout from "@/ui/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import EmptyState from "@/components/EmptyState";
import { isCloud } from "@/services/env";
import CustomHookModal from "@/components/CustomHooks/CustomHookModal";
import CustomHooksTable from "@/components/CustomHooks/CustomHooksTable";
import Link from "@/ui/Link";

// Feature- and config-scoped hooks are managed from their entity's Validation
// tab; here they are listed with a link to that entity plus history/revert.
function EntityScopedHooksSection({
  title,
  description,
  entityLabel,
  entityHref,
  hooks,
  mutate,
}: {
  title: string;
  description: string;
  entityLabel: string;
  entityHref: (hook: CustomHookInterface) => string;
  hooks: CustomHookInterface[];
  mutate: () => void;
}) {
  if (!hooks.length) return null;
  return (
    <div className="mt-5">
      <h2>{title}</h2>
      <p className="text-muted">{description}</p>
      <CustomHooksTable
        hooks={hooks}
        column={{
          header: entityLabel,
          render: (hook) => (
            <Link href={entityHref(hook)}>{hook.entityId}</Link>
          ),
        }}
        canManage={() => false}
        canRevert={() => true}
        mutate={mutate}
      />
    </div>
  );
}

export default function CustomHooksPage() {
  const [modalData, setModalData] = useState<null | true | CustomHookInterface>(
    null,
  );

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
              <CustomHooksTable
                hooks={hooks}
                column={{
                  header: "Projects",
                  render: (hook) =>
                    hook.projects.length ? (
                      hook.projects.join(", ")
                    ) : (
                      <em>All Projects</em>
                    ),
                }}
                canManage={() => true}
                onEdit={setModalData}
                mutate={mutate}
              />
            )}
          </div>

          <EntityScopedHooksSection
            title="Feature-specific Hooks"
            description="These hooks are scoped to a single feature and managed from that feature's Validation tab."
            entityLabel="Feature"
            entityHref={(hook) => `/features/${hook.entityId}#validation`}
            hooks={featureHooks}
            mutate={mutate}
          />

          <EntityScopedHooksSection
            title="Config-specific Hooks"
            description="These hooks are scoped to a single Config and managed from that Config's Validation tab."
            entityLabel="Config"
            entityHref={(hook) => `/configs/${hook.entityId}#validation`}
            hooks={configHooks}
            mutate={mutate}
          />

          {experimentHooks.length > 0 && (
            <div className="mt-5">
              <h2>Experiment-specific Hooks</h2>
              <p className="text-muted">
                These hooks are scoped to a single experiment. Experiment hooks
                are now managed as global hooks above; you can remove any
                leftover scoped hooks here.
              </p>
              <CustomHooksTable
                hooks={experimentHooks}
                column={{
                  header: "Experiment",
                  render: (hook) => (
                    <Link href={`/experiment/${hook.entityId}`}>
                      {hook.entityId}
                    </Link>
                  ),
                }}
                canManage={() => true}
                mutate={mutate}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
