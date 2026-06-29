import { ReactNode } from "react";
import isEqual from "lodash/isEqual";
import { ConstantInterface } from "shared/types/constant";
import { Box } from "@radix-ui/themes";
import {
  ChangeField,
  TextChangedField,
  OwnerName,
  ProjectName,
} from "@/components/AuditHistoryExplorer/DiffRenderUtils";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";
import { RevisionDiffConfig } from "@/components/Revision/useRevisionDiff";

type Pre = Partial<ConstantInterface> | null;
type Post = Partial<ConstantInterface>;

// One value chunk. Short, single-line values render inline (Δ → ); multi-line /
// JSON values render as before/after boxes.
function ValueRow({
  label,
  pre,
  post,
}: {
  label?: string;
  pre?: string;
  post?: string;
}) {
  if ((pre ?? "") === (post ?? "")) return null;
  const isSimple = (v?: string) => !v || (!v.includes("\n") && v.length <= 80);
  if (isSimple(pre) && isSimple(post)) {
    return (
      <ChangeField
        label={label}
        changed
        oldNode={pre ? pre : <em>(empty)</em>}
        newNode={post ? post : <em>(empty)</em>}
      />
    );
  }
  return (
    <TextChangedField
      label={label}
      pre={pre ?? null}
      post={post ?? null}
      emptyLabel="(empty)"
    />
  );
}

// normalizeSnapshot parses JSON-typed values into objects (so the raw diff
// expands them), so a value may arrive here already parsed. Re-stringify
// non-strings for display, matching how saved groups handle `condition`.
function toStr(v: unknown): string | undefined {
  if ((v ?? null) === null) return undefined;
  return typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

// Value + per-environment overrides, chunked one block per value (Value, then
// each environment) rather than a single JSON blob.
export function renderConstantValues(pre: Pre, post: Post): ReactNode | null {
  const rows: ReactNode[] = [
    <ValueRow key="__value" pre={toStr(pre?.value)} post={toStr(post.value)} />,
  ];

  const preEnvs = pre?.environmentValues ?? {};
  const postEnvs = post.environmentValues ?? {};
  const envIds = Array.from(
    new Set([...Object.keys(preEnvs), ...Object.keys(postEnvs)]),
  ).sort();
  for (const env of envIds) {
    rows.push(
      <ValueRow
        key={env}
        label={env}
        pre={toStr(preEnvs[env])}
        post={toStr(postEnvs[env])}
      />,
    );
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
        label="Name"
        changed
        oldNode={pre?.name ?? <em>None</em>}
        newNode={post.name}
      />,
    );
  }

  if (!isEqual(pre?.owner, post.owner) && post.owner !== undefined) {
    rows.push(
      <ChangeField
        key="owner"
        label="Owner"
        changed
        oldNode={pre?.owner ? <OwnerName id={pre.owner} /> : <em>unset</em>}
        newNode={post.owner ? <OwnerName id={post.owner} /> : <em>unset</em>}
      />,
    );
  }

  if (
    (pre?.description || "") !== (post.description || "") &&
    post.description !== undefined
  ) {
    rows.push(
      <TextChangedField
        key="description"
        label="Description"
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
        label="Status"
        changed
        oldNode={preArchived ? "Archived" : "Active"}
        newNode={postArchived ? "Archived" : "Active"}
      />,
    );
  }

  if (!isEqual(pre?.project, post.project)) {
    const node = (id: string | undefined) =>
      id ? <ProjectName id={id} /> : <em>All Projects</em>;
    rows.push(
      <ChangeField
        key="project"
        label="Project"
        changed
        oldNode={node(pre?.project)}
        newNode={node(post.project)}
      />,
    );
  }

  return rows.length ? <Box mt="1">{rows}</Box> : null;
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

export const REVISION_CONSTANT_DIFF_CONFIG: RevisionDiffConfig<ConstantInterface> =
  {
    sections: [
      {
        label: "Settings",
        keys: [
          "name",
          "owner",
          "description",
          "project",
          "archived",
        ] as (keyof ConstantInterface)[],
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
    // For JSON constants, parse the value (and per-env overrides) into objects
    // so the raw diff expands them as nested JSON rather than escaped strings.
    // Mirrors the saved-group `condition` and feature value handling.
    normalizeSnapshot: (snapshot: ConstantInterface): ConstantInterface => {
      if (snapshot.type !== "json") return snapshot;
      const parse = (v: string): string => {
        if (v === "") return v;
        try {
          // JSON.parse returns `any`; the parsed object flows through the
          // diff's stringify step, which re-serializes it as pretty JSON.
          return JSON.parse(v);
        } catch {
          return v; // leave invalid/legacy JSON as-is
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
    },
  };
