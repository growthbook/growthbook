import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useForm } from "react-hook-form";
import { ConfigWithoutValue } from "shared/types/config";
import { Revision } from "shared/enterprise";
import { generateTrackingKey } from "shared/experiments";
import {
  getConfigParentKey,
  getConfigSubtree,
  isScopedConfig,
} from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SelectOwner from "@/components/Owner/SelectOwner";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
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
  // Composition mixins (config keys) layered on top of `parent`, in precedence
  // order (later overrides earlier; all override `parent`; own keys win last).
  extends: string[];
  owner: string;
  description: string;
  project: string;
  extensible: boolean;
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
  const { organization } = useUser();
  const {
    configs,
    _configsIncludingArchived: allConfigsForGraph,
    projects,
    project,
    mutateDefinitions,
    getConfigByKey,
  } = useDefinitions();

  const editing = !!existing;
  const orgExtensibleDefault =
    organization?.settings?.configsExtensibleByDefault ?? true;
  // Extensibility is a base-config policy: it only applies to the root of a
  // lineage (children inherit it). Hidden for child configs.
  const isBaseConfig = editing
    ? getConfigParentKey(existing ?? {}) === null
    : !(parentKey ?? "");

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
      extends: existing?.extends ?? [],
      owner: existing?.owner ?? "",
      description: existing?.description ?? "",
      project: existing?.project ?? project ?? "",
      extensible: existing?.extensible ?? orgExtensibleDefault,
    },
  });

  // For create, the base/child distinction follows the selected parent.
  const isBaseSelection = editing ? isBaseConfig : !form.watch("parent");

  // Env/project override flavors are variants of a specific base, never a
  // standalone base — exclude them so they can't be chosen as a parent or mixin.
  const parentOptions = configs
    .filter((c) => !c.archived && !isScopedConfig(c) && c.key !== existing?.key)
    .map((c) => ({ label: c.name, value: c.key }));
  const projectOptions = projects.map((p) => ({ label: p.name, value: p.id }));

  // Mixin candidates: any config except this one, its current `parent`, and its
  // own descendants (which would close a composition cycle). Archived configs are
  // excluded as candidates, but the descendant walk uses the archived-inclusive
  // graph so a cycle through an archived intermediate is still excluded.
  const currentParent = editing
    ? (existing?.parent ?? "")
    : form.watch("parent");
  const descendantKeys = existing?.key
    ? new Set(getConfigSubtree(existing.key, allConfigsForGraph))
    : new Set<string>();
  const extendsOptions = configs
    .filter(
      (c) =>
        !c.archived &&
        !isScopedConfig(c) &&
        c.key !== existing?.key &&
        c.key !== currentParent &&
        !descendantKeys.has(c.key),
    )
    .map((c) => ({ label: c.name, value: c.key }));

  // Auto-derive the slug key from the name until the user edits the key.
  const keyTouched = useRef(editing);
  const name = form.watch("name");
  useEffect(() => {
    if (editing || keyTouched.current || !name) return;
    let active = true;
    // Config keys are unique within the config namespace only (a constant may
    // share the key), so derive the slug against existing configs.
    generateTrackingKey({ name }, async (k) => getConfigByKey(k)).then((k) => {
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
                ...(isBaseConfig ? { extensible: values.extensible } : {}),
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
              // Dedupe and drop the parent (it's the spine, not a mixin) so we
              // never submit a self-conflicting composition the backend rejects.
              extends: (() => {
                const cleaned = [...new Set(values.extends)].filter(
                  (k) => k && k !== values.parent,
                );
                return cleaned.length ? cleaned : undefined;
              })(),
              description: values.description || undefined,
              project: values.project || undefined,
              ...(values.parent ? {} : { extensible: values.extensible }),
            }),
          });
          await mutateDefinitions();
          await router.push(`/configs/${values.key}`);
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
          formatOptionLabel={({ value, label }) =>
            value ? (
              <Flex as="span" align="center" gap="1" width="100%">
                <span>{label}</span>
                <code style={{ marginLeft: "auto", color: "var(--slate-12)" }}>
                  {value}
                </code>
              </Flex>
            ) : (
              <span>{label}</span>
            )
          }
          helpText="A child inherits its parent's fields and overrides a subset."
        />
      )}

      {/* Composition is set here at creation; for an existing config it's edited
          inline in a draft on the config page. */}
      {!editing && (
        <MultiSelectField
          label="Compose additional configs (optional)"
          value={form.watch("extends")}
          onChange={(v) => form.setValue("extends", v)}
          options={extendsOptions}
          sort={false}
          placeholder="Add mixin configs…"
          helpText="Mixins layer on top of the parent, in order (later overrides earlier; this config's own fields win last). Drag to reorder."
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

      {isBaseSelection && (
        <Box mt="3">
          <Checkbox
            label="Allow extra fields in extensions"
            description={
              <Text weight="regular" color="text-high">
                Child configs and feature flag rules can add keys beyond this
                Config&apos;s schema.
              </Text>
            }
            value={form.watch("extensible")}
            setValue={(v) => form.setValue("extensible", v)}
          />
        </Box>
      )}
    </ModalStandard>
  );
}
