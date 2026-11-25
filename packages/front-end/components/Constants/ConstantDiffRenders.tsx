import { ReactNode } from "react";
import isEqual from "lodash/isEqual";
import { ConstantInterface } from "shared/types/constant";
import { ConfigInterface } from "shared/types/config";
import { describeInvariantRule } from "shared/util";
import { Box } from "@radix-ui/themes";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  ChangeField,
  TextChangedField,
  OwnerName,
  ProjectName,
} from "@/components/AuditHistoryExplorer/DiffRenderUtils";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";
import { RevisionDiffConfig } from "@/components/Revision/useRevisionDiff";
import { SCHEMA_LANG_LABEL } from "@/components/Configs/fieldSchema";

// Combined shape so the render/badge helpers serve both constants and configs.
type DiffShape = ConstantInterface & ConfigInterface;
type Pre = Partial<DiffShape> | null;
type Post = Partial<DiffShape>;

// Short values render inline; multi-line/JSON as before/after boxes.
function ValueRow({
  label,
  pre,
  post,
}: {
  // A descriptor for UI text; a plain string for user data (paths, names).
  label?: string | MessageDescriptor;
  pre?: string;
  post?: string;
}) {
  const { t, i18n } = useLingui();
  if ((pre ?? "") === (post ?? "")) return null;
  const labelText =
    label === undefined || typeof label === "string" ? label : i18n._(label);
  const emptyText = t`(empty)`;
  const isSimple = (v?: string) => !v || (!v.includes("\n") && v.length <= 80);
  if (isSimple(pre) && isSimple(post)) {
    return (
      <ChangeField
        label={labelText}
        changed
        oldNode={pre ? pre : <em>{emptyText}</em>}
        newNode={post ? post : <em>{emptyText}</em>}
      />
    );
  }
  return (
    <TextChangedField
      label={labelText}
      pre={pre ?? null}
      post={post ?? null}
      emptyLabel={emptyText}
    />
  );
}

// TextChangedField takes its label as a string, so resolve it in a component.
function TranslatedTextChangedField({
  label,
  pre,
  post,
}: {
  label: MessageDescriptor;
  pre: string | null;
  post: string | null;
}) {
  const { i18n } = useLingui();
  return <TextChangedField label={i18n._(label)} pre={pre} post={post} />;
}

// Values may arrive already parsed (see normalizeSnapshot); re-stringify.
function toStr(v: unknown): string | undefined {
  if ((v ?? null) === null) return undefined;
  return typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Drill into two parsed JSON objects, emitting one row per changed leaf keyed by
// its dotted path (e.g. `port`, `db.host`). Arrays and scalars are leaves, so a
// changed array shows whole. Falls back to a single before/after row when the
// values aren't both objects (scalar value, type change, create/delete).
function valueDiffRows(pre: unknown, post: unknown, path: string): ReactNode[] {
  if (isPlainObject(pre) && isPlainObject(post)) {
    const keys = Array.from(
      new Set([...Object.keys(pre), ...Object.keys(post)]),
    ).sort();
    return keys.flatMap((k) =>
      valueDiffRows(pre[k], post[k], path ? `${path}.${k}` : k),
    );
  }
  if (isEqual(pre, post)) return [];
  return [
    <ValueRow
      key={path || "__value"}
      label={path || undefined}
      pre={toStr(pre)}
      post={toStr(post)}
    />,
  ];
}

// Value + per-environment overrides, drilled to field-level rows for JSON.
export function renderConstantValues(pre: Pre, post: Post): ReactNode | null {
  const rows: ReactNode[] = [...valueDiffRows(pre?.value, post.value, "")];

  const preEnvs = pre?.environmentValues ?? {};
  const postEnvs = post.environmentValues ?? {};
  const envIds = Array.from(
    new Set([...Object.keys(preEnvs), ...Object.keys(postEnvs)]),
  ).sort();
  for (const env of envIds) {
    rows.push(...valueDiffRows(preEnvs[env], postEnvs[env], env));
  }

  const visible = rows.filter(Boolean);
  return visible.length ? <Box mt="1">{visible}</Box> : null;
}

export function renderConstantSettings(pre: Pre, post: Post): ReactNode | null {
  const rows: ReactNode[] = [];

  if (!isEqual(pre?.name, post.name) && post.name !== undefined) {
    rows.push(
      <ChangeField
        key="name"
        label={<Trans>Name</Trans>}
        changed
        oldNode={
          pre?.name ?? (
            <em>
              <Trans>None</Trans>
            </em>
          )
        }
        newNode={post.name}
      />,
    );
  }

  if (!isEqual(pre?.owner, post.owner) && post.owner !== undefined) {
    rows.push(
      <ChangeField
        key="owner"
        label={<Trans>Owner</Trans>}
        changed
        oldNode={
          pre?.owner ? (
            <OwnerName id={pre.owner} />
          ) : (
            <em>
              <Trans>unset</Trans>
            </em>
          )
        }
        newNode={
          post.owner ? (
            <OwnerName id={post.owner} />
          ) : (
            <em>
              <Trans>unset</Trans>
            </em>
          )
        }
      />,
    );
  }

  if (
    (pre?.description || "") !== (post.description || "") &&
    post.description !== undefined
  ) {
    rows.push(
      <TranslatedTextChangedField
        key="description"
        label={msg`Description`}
        pre={pre?.description || null}
        post={post.description || null}
      />,
    );
  }

  const preArchived = !!pre?.archived;
  const postArchived = !!post.archived;
  if (post.archived !== undefined && preArchived !== postArchived) {
    rows.push(
      <ChangeField
        key="archived"
        label={<Trans>Status</Trans>}
        changed
        oldNode={preArchived ? <Trans>Archived</Trans> : <Trans>Active</Trans>}
        newNode={postArchived ? <Trans>Archived</Trans> : <Trans>Active</Trans>}
      />,
    );
  }

  if ((pre?.project ?? "") !== (post.project ?? "")) {
    const node = (id: string | undefined) =>
      id ? (
        <ProjectName id={id} />
      ) : (
        <em>
          <Trans>All Projects</Trans>
        </em>
      );
    rows.push(
      <ChangeField
        key="project"
        label={<Trans>Project</Trans>}
        changed
        oldNode={node(pre?.project)}
        newNode={node(post.project)}
      />,
    );
  }

  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

// Friendly labels for the SimpleSchema field attributes (the canonical config
// schema that JSON Schema and the language projections are generated from).
const SCHEMA_FIELD_PROP_LABELS: Record<string, string> = {
  type: "type",
  required: "required",
  default: "default",
  description: "description",
  enum: "allowed values",
  min: "min",
  max: "max",
  nullable: "nullable",
  jsonSchema: "JSON Schema",
};

// Diff of the config schema (`schema.fields` — the structured field definitions,
// not a projection). One row per changed field attribute, e.g. `port → type`.
export function renderConstantSchema(pre: Pre, post: Post): ReactNode | null {
  const preFields = pre?.schema?.fields ?? [];
  const postFields = post.schema?.fields ?? [];
  if (isEqual(preFields, postFields)) return null;

  const keys = Array.from(
    new Set([...preFields.map((f) => f.key), ...postFields.map((f) => f.key)]),
  ).sort();
  const rows: ReactNode[] = [];
  for (const k of keys) {
    const a = preFields.find((f) => f.key === k);
    const b = postFields.find((f) => f.key === k);
    if (isEqual(a, b)) continue;

    // Added or removed field → one row with the whole definition.
    if (!a || !b) {
      const label = a
        ? k
          ? msg`${k} field — removed`
          : msg`(unnamed) field — removed`
        : k
          ? msg`${k} field — added`
          : msg`(unnamed) field — added`;
      rows.push(
        <ValueRow
          key={k}
          label={label}
          pre={a ? JSON.stringify(a, null, 2) : undefined}
          post={b ? JSON.stringify(b, null, 2) : undefined}
        />,
      );
      continue;
    }

    // Edited field → one row per changed attribute, with a friendly label.
    const aRec = a as Record<string, unknown>;
    const bRec = b as Record<string, unknown>;
    const props = Array.from(
      new Set([...Object.keys(aRec), ...Object.keys(bRec)]),
    ).filter((p) => p !== "key");
    for (const p of props) {
      if (isEqual(aRec[p], bRec[p])) continue;
      const propLabel = SCHEMA_FIELD_PROP_LABELS[p] ?? p;
      rows.push(
        <ValueRow
          key={`${k}.${p}`}
          label={
            k
              ? msg`${k} field → ${propLabel}`
              : msg`(unnamed) field → ${propLabel}`
          }
          pre={toStr(aRec[p])}
          post={toStr(bRec[p])}
        />,
      );
    }
  }
  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

export function getConstantSchemaBadges(pre: Pre, post: Post): DiffBadge[] {
  const preFields = pre?.schema?.fields ?? [];
  const postFields = post.schema?.fields ?? [];
  if (isEqual(preFields, postFields)) return [];

  const preKeys = new Set(preFields.map((f) => f.key));
  const postKeys = new Set(postFields.map((f) => f.key));
  const added = [...postKeys].filter((k) => !preKeys.has(k)).length;
  const removed = [...preKeys].filter((k) => !postKeys.has(k)).length;
  const edited = [...postKeys].filter(
    (k) =>
      preKeys.has(k) &&
      !isEqual(
        preFields.find((f) => f.key === k),
        postFields.find((f) => f.key === k),
      ),
  ).length;

  const badges: DiffBadge[] = [];
  const plural = (n: number) => (n !== 1 ? "s" : "");
  if (added)
    badges.push({
      label: `${added} field${plural(added)} added`,
      action: "add field",
    });
  if (removed)
    badges.push({
      label: `${removed} field${plural(removed)} removed`,
      action: "remove field",
    });
  if (edited)
    badges.push({
      label: `${edited} field${plural(edited)} edited`,
      action: "edit field",
    });
  return badges;
}

// Config cross-field validation rules (`schema.invariants`), one row per changed
// rule. Kept in its own diff section so a rules-only change still shows up as a
// tracked part of the revision (fields may be untouched).
export function renderConfigInvariants(pre: Pre, post: Post): ReactNode | null {
  const preInv = pre?.schema?.invariants ?? [];
  const postInv = post.schema?.invariants ?? [];
  if (isEqual(preInv, postInv)) return null;

  // Simple, readable view: `field ≠ "value" — "message"` rather than raw JSONLogic.
  const describe = (inv: { rule: string; message: string }): string => {
    const expr = describeInvariantRule(inv.rule);
    return inv.message ? `${expr} — "${inv.message}"` : expr;
  };

  const names = Array.from(
    new Set([...preInv.map((i) => i.name), ...postInv.map((i) => i.name)]),
  ).sort();
  const rows: ReactNode[] = [];
  for (const n of names) {
    const a = preInv.find((i) => i.name === n);
    const b = postInv.find((i) => i.name === n);
    if (isEqual(a, b)) continue;
    rows.push(
      <ValueRow
        key={n}
        label={n || msg`(new rule)`}
        pre={a ? describe(a) : undefined}
        post={b ? describe(b) : undefined}
      />,
    );
  }
  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

export function getConfigInvariantBadges(pre: Pre, post: Post): DiffBadge[] {
  const preInv = pre?.schema?.invariants ?? [];
  const postInv = post.schema?.invariants ?? [];
  if (isEqual(preInv, postInv)) return [];

  const preNames = new Set(preInv.map((i) => i.name));
  const postNames = new Set(postInv.map((i) => i.name));
  const added = [...postNames].filter((n) => !preNames.has(n)).length;
  const removed = [...preNames].filter((n) => !postNames.has(n)).length;
  const edited = [...postNames].filter(
    (n) =>
      preNames.has(n) &&
      !isEqual(
        preInv.find((i) => i.name === n),
        postInv.find((i) => i.name === n),
      ),
  ).length;

  const badges: DiffBadge[] = [];
  const plural = (n: number) => (n !== 1 ? "s" : "");
  if (added)
    badges.push({
      label: `${added} rule${plural(added)} added`,
      action: "add rule",
    });
  if (removed)
    badges.push({
      label: `${removed} rule${plural(removed)} removed`,
      action: "remove rule",
    });
  if (edited)
    badges.push({
      label: `${edited} rule${plural(edited)} edited`,
      action: "edit rule",
    });
  return badges;
}

export function getConstantSettingsBadges(pre: Pre, post: Post): DiffBadge[] {
  const badges: DiffBadge[] = [];
  if (!isEqual(pre?.name, post.name) && post.name !== undefined)
    badges.push({ label: "Edit name", action: "edit name" });
  if (!isEqual(pre?.owner, post.owner) && post.owner !== undefined)
    badges.push({ label: "Edit owner", action: "edit owner" });
  if ((pre?.description || "") !== (post.description || ""))
    badges.push({ label: "Edit description", action: "edit description" });
  if (post.archived !== undefined && !!pre?.archived !== !!post.archived)
    badges.push(
      post.archived
        ? { label: "Archive", action: "archive" }
        : { label: "Unarchive", action: "unarchive" },
    );
  if (!isEqual(pre?.project ?? "", post.project ?? ""))
    badges.push({ label: "Edit project", action: "edit project" });
  return badges;
}

export function getConstantValuesBadges(pre: Pre, post: Post): DiffBadge[] {
  const badges: DiffBadge[] = [];
  // Values may be parsed objects post-normalization; compare stringified.
  if ((toStr(pre?.value) ?? "") !== (toStr(post.value) ?? ""))
    badges.push({ label: "Edit value", action: "edit value" });

  const preEnvs = pre?.environmentValues ?? {};
  const postEnvs = post.environmentValues ?? {};
  const envIds = new Set([...Object.keys(preEnvs), ...Object.keys(postEnvs)]);
  const changed = [...envIds].filter(
    (env) => (toStr(preEnvs[env]) ?? "") !== (toStr(postEnvs[env]) ?? ""),
  );
  if (changed.length)
    badges.push({
      label: `${changed.length} override${changed.length !== 1 ? "s" : ""}`,
      action: "edit overrides",
    });
  return badges;
}

// Parse values to objects so the raw diff expands them as nested JSON.
function parseJsonValues<T extends Partial<DiffShape>>(snapshot: T): T {
  const parse = (v: string): string => {
    if (v === "") return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };
  const result = { ...snapshot };
  if (typeof result.value === "string") {
    result.value = parse(result.value);
  }
  if (result.environmentValues) {
    const parsed: Record<string, string> = {};
    for (const [env, val] of Object.entries(result.environmentValues)) {
      parsed[env] = typeof val === "string" ? parse(val) : val;
    }
    result.environmentValues = parsed;
  }
  return result;
}

const SETTINGS_KEYS = [
  "name",
  "owner",
  "description",
  "project",
  "archived",
] as const;

export const REVISION_CONSTANT_DIFF_CONFIG: RevisionDiffConfig<ConstantInterface> =
  {
    sections: [
      {
        label: "Settings",
        keys: [...SETTINGS_KEYS] as (keyof ConstantInterface)[],
        render: renderConstantSettings,
        getBadges: getConstantSettingsBadges,
      },
      {
        label: "Value",
        keys: ["value", "environmentValues"] as (keyof ConstantInterface)[],
        render: renderConstantValues,
        getBadges: getConstantValuesBadges,
      },
    ],
    normalizeSnapshot: (snapshot: ConstantInterface): ConstantInterface => {
      if (snapshot.type !== "json") return snapshot;
      return parseJsonValues(snapshot);
    },
  };

// Parent, mixins and extensibility change the effective schema, so a draft that
// only changes them still has something to review and publish.
function configLineageRows(pre: Pre, post: Post) {
  const none = (
    <em>
      <Trans>None</Trans>
    </em>
  );
  const list = (keys?: string[]) => (keys?.length ? keys.join(", ") : none);
  const allows = (v?: boolean) =>
    (v ?? null) === null ? (
      <em>
        <Trans>Default</Trans>
      </em>
    ) : v ? (
      <Trans>Yes</Trans>
    ) : (
      <Trans>No</Trans>
    );
  return [
    {
      key: "parent",
      label: <Trans>Parent Config</Trans>,
      badge: "Edit parent",
      changed: (pre?.parent || "") !== (post.parent || ""),
      oldNode: pre?.parent || none,
      newNode: post.parent || none,
    },
    {
      key: "extends",
      label: <Trans>Config mixins</Trans>,
      badge: "Edit mixins",
      changed: !isEqual(pre?.extends ?? [], post.extends ?? []),
      oldNode: list(pre?.extends),
      newNode: list(post.extends),
    },
    {
      key: "extensible",
      label: <Trans>Allow extra fields</Trans>,
      badge: "Edit extra fields",
      // Only a base Config's setting applies.
      changed:
        !post.parent && (pre?.extensible ?? null) !== (post.extensible ?? null),
      oldNode: allows(pre?.extensible),
      newNode: allows(post.extensible),
    },
  ].filter((row) => row.changed);
}

export function renderConfigLineage(pre: Pre, post: Post): ReactNode | null {
  const rows = configLineageRows(pre, post);
  return rows.length ? (
    <Box mt="1">
      {rows.map((row) => (
        <ChangeField
          key={row.key}
          label={row.label}
          changed
          oldNode={row.oldNode}
          newNode={row.newNode}
        />
      ))}
    </Box>
  ) : null;
}

export function getConfigLineageBadges(pre: Pre, post: Post): DiffBadge[] {
  return configLineageRows(pre, post).map((row) => ({
    label: row.badge,
    action: row.badge.toLowerCase(),
  }));
}

// A projection-only draft still has something to review and publish.
function configProjectionRows(pre: Pre, post: Post) {
  const before = pre?.renderProjections ?? {};
  const after = post.renderProjections ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter((source) => !isEqual(before[source], after[source]))
    .map((source) => ({ source, from: before[source], to: after[source] }));
}

export function renderConfigProjections(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const rows = configProjectionRows(pre, post);
  const lang = (id: string) => SCHEMA_LANG_LABEL[id] ?? id;
  return rows.length ? (
    <Box mt="1">
      {rows.map(({ source, from, to }) => {
        const none = (
          <em>
            <Trans>None</Trans>
          </em>
        );
        const toLang = to ? lang(to.language) : "";
        return (
          <ChangeField
            key={source}
            label={source}
            changed
            oldNode={from ? lang(from.language) : none}
            newNode={
              !to ? (
                none
              ) : from?.language === to.language ? (
                <Trans>{toLang} (updated)</Trans>
              ) : (
                toLang
              )
            }
          />
        );
      })}
    </Box>
  ) : null;
}

export function getConfigProjectionBadges(pre: Pre, post: Post): DiffBadge[] {
  return configProjectionRows(pre, post).length
    ? [{ label: "Edit projections", action: "edit projections" }]
    : [];
}

export const REVISION_CONFIG_DIFF_CONFIG: RevisionDiffConfig<ConfigInterface> =
  {
    sections: [
      {
        label: "Settings",
        keys: [...SETTINGS_KEYS] as (keyof ConfigInterface)[],
        render: renderConstantSettings,
        getBadges: getConstantSettingsBadges,
      },
      {
        label: "Inheritance",
        keys: ["parent", "extends", "extensible"] as (keyof ConfigInterface)[],
        render: renderConfigLineage,
        getBadges: getConfigLineageBadges,
      },
      {
        // Configs are environment-agnostic — no `environmentValues`.
        label: "Value",
        keys: ["value"] as (keyof ConfigInterface)[],
        render: renderConstantValues,
        getBadges: getConstantValuesBadges,
      },
      {
        label: "Schema",
        keys: ["schema"] as (keyof ConfigInterface)[],
        render: renderConstantSchema,
        getBadges: getConstantSchemaBadges,
      },
      {
        label: "Validation rules",
        keys: ["schema"] as (keyof ConfigInterface)[],
        render: renderConfigInvariants,
        getBadges: getConfigInvariantBadges,
      },
      {
        label: "Named projections",
        keys: ["renderProjections"] as (keyof ConfigInterface)[],
        render: renderConfigProjections,
        getBadges: getConfigProjectionBadges,
      },
    ],
    // Configs are always JSON objects, so their value/overrides are always parsed.
    normalizeSnapshot: (snapshot: ConfigInterface): ConfigInterface =>
      parseJsonValues(snapshot),
  };
