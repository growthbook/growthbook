import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useForm } from "react-hook-form";
import { ConfigWithoutValue } from "shared/types/config";
import { Revision } from "shared/enterprise";
import { generateTrackingKey } from "shared/experiments";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import SelectOwner from "@/components/Owner/SelectOwner";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import ConstantDraftSelectorForChanges from "@/components/Constants/ConstantDraftSelectorForChanges";
import {
  useConstantDraftTarget,
  ConstantRevisionContext,
} from "@/components/Constants/useConstantDraftTarget";

// Empty context used on the create path, where there is no revision flow.
const EMPTY_REVISION_CTX: ConstantRevisionContext = {
  allRevisions: [],
  openRevisions: [],
  selectedRevision: null,
  approvalRequired: false,
  metadataReviewRequired: false,
  canBypassApproval: false,
};

type FormValues = {
  key: string;
  name: string;
  parent: string;
  owner: string;
  description: string;
  project: string;
};

// Create a config or edit its info. Configs are JSON objects referenced via
// `$extends`; inheritance is recorded on `parent` (no `$extends` in the value).
export default function ConfigModal({
  existing,
  parentKey,
  revisionCtx,
  onSaved,
  close,
}: {
  // Present → edit info; absent → create.
  existing?: ConfigWithoutValue | null;
  // Pre-selected parent when creating a child config from a parent's editor.
  parentKey?: string;
  // Required when editing (info changes route through the revision system).
  revisionCtx?: ConstantRevisionContext;
  onSaved?: (revision: Revision) => void | Promise<void>;
  close: () => void;
}) {
  const router = useRouter();
  const { apiCall } = useAuth();
  const {
    configs,
    projects,
    project,
    mutateDefinitions,
    getConfigByKey,
    getConstantByKey,
  } = useDefinitions();

  const editing = !!existing;
  const [error, setError] = useState<string | null>(null);

  // Description is opt-in behind a "+ Add a description" link, expanded by
  // default when one already exists.
  const [showDescription, setShowDescription] = useState(
    !!existing?.description,
  );

  // Called unconditionally (rules of hooks); unused on the create path.
  const draft = useConstantDraftTarget(revisionCtx ?? EMPTY_REVISION_CTX, true);

  const form = useForm<FormValues>({
    defaultValues: {
      key: existing?.key ?? "",
      name: existing?.name ?? "",
      parent: parentKey ?? "",
      owner: existing?.owner ?? "",
      description: existing?.description ?? "",
      project: existing?.project ?? project ?? "",
    },
  });

  const parentOptions = configs
    .filter((c) => !c.archived && c.key !== existing?.key)
    .map((c) => ({ label: c.name, value: c.key }));
  const projectOptions = projects.map((p) => ({ label: p.name, value: p.id }));

  // Auto-derive the slug key from the name until the user edits the key.
  const keyTouched = useRef(editing);
  const name = form.watch("name");
  useEffect(() => {
    if (editing || keyTouched.current || !name) return;
    let active = true;
    // Keys are unique across configs and constants, so check both.
    generateTrackingKey(
      { name },
      async (k) => getConfigByKey(k) ?? getConstantByKey(k),
    ).then((k) => {
      if (active) form.setValue("key", k);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, editing]);

  return (
    <ModalStandard
      open={true}
      trackingEventModalType="config-modal"
      header={editing ? "Edit info" : "New config"}
      size="lg"
      close={close}
      cta={editing ? "Save" : "Create"}
      submit={form.handleSubmit(async (values) => {
        setError(null);
        try {
          if (editing && existing) {
            const res = await apiCall<{ revision?: Revision }>(
              `/configs/${existing.id}${draft.buildQueryString()}`,
              {
                method: "PUT",
                body: JSON.stringify({
                  name: values.name,
                  owner: values.owner,
                  description: values.description || undefined,
                  project: values.project,
                }),
              },
            );
            await mutateDefinitions();
            if (onSaved && res?.revision) {
              await onSaved(res.revision);
            }
          } else {
            await apiCall(`/configs`, {
              method: "POST",
              body: JSON.stringify({
                key: values.key,
                name: values.name,
                parent: values.parent || undefined,
                description: values.description || undefined,
                project: values.project || undefined,
              }),
            });
            await mutateDefinitions();
            await router.push(`/configs/${values.key}`);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to save config");
        }
      })}
    >
      {!editing && (
        <Callout status="info" mb="3">
          Configs are referenced from a feature flag — define the fields and
          values here, then reference the config from a flag to deliver it to
          your SDKs.
        </Callout>
      )}

      {editing && existing && revisionCtx && (
        <ConstantDraftSelectorForChanges
          constantId={existing.id}
          openRevisions={revisionCtx.openRevisions}
          allRevisions={revisionCtx.allRevisions}
          mode={draft.draftMode}
          setMode={draft.setDraftMode}
          selectedDraftId={draft.draftSelectedId}
          setSelectedDraftId={draft.setDraftSelectedId}
          canAutoPublish={draft.canAutoPublish}
          approvalRequired={draft.selectorApprovalRequired}
          metadataOnly={draft.metadataOnly}
        />
      )}

      <Field label="Name" required {...form.register("name")} />
      <Field
        label="Key"
        required
        helpText={
          <>
            Referenced as{" "}
            <code>{`"$extends": ["@const:${form.watch("key") || "key"}"]`}</code>
          </>
        }
        disabled={editing}
        {...form.register("key", {
          onChange: () => {
            keyTouched.current = true;
          },
        })}
      />

      {showDescription ? (
        <Box mb="3">
          <Box mb="1">
            <Text as="label" weight="semibold">
              Description
            </Text>
          </Box>
          <MarkdownInput
            value={form.watch("description")}
            setValue={(v) => form.setValue("description", v)}
            placeholder="Add notes about this config (markdown supported)"
            showButtons={false}
            hidePreview={false}
          />
        </Box>
      ) : (
        <Link
          mb="3"
          onClick={(e) => {
            e.preventDefault();
            setShowDescription(true);
          }}
        >
          <Flex align="center" gap="1">
            <PiPlus />
            <Text weight="medium">Add a description</Text>
          </Flex>
        </Link>
      )}

      {!editing && (
        <SelectField
          label="Parent config (optional)"
          value={form.watch("parent")}
          onChange={(v) => form.setValue("parent", v)}
          options={parentOptions}
          initialOption="None (base config)"
          formatOptionLabel={({ value, label }) => (
            <span>
              {label}
              {value && (
                <code
                  className="float-right position-relative"
                  style={{ top: 1, color: "var(--slate-12)" }}
                >
                  {value}
                </code>
              )}
            </span>
          )}
          helpText="A child inherits its parent's fields and overrides a subset."
        />
      )}

      {projectOptions.length > 0 && (
        <SelectField
          label="Project"
          value={form.watch("project")}
          options={projectOptions}
          initialOption="All projects"
          onChange={(v) => form.setValue("project", v)}
        />
      )}

      {editing && (
        <SelectOwner
          placeholder="Optional"
          value={form.watch("owner")}
          onChange={(v) => form.setValue("owner", v)}
        />
      )}

      {error && (
        <Callout status="error" mt="2">
          {error}
        </Callout>
      )}
    </ModalStandard>
  );
}
