import { ConfigInterface } from "shared/types/config";
import { getConfigAncestorKeys, getConfigSubtree } from "shared/util";
import { useMemo } from "react";
import Link from "@/ui/Link";
import CustomHooksSection from "@/components/CustomHooks/CustomHooksSection";

// Config publish-time custom hooks — the Config analog of FeatureValidationTab's
// hooks section. Self-hosted + enterprise only.
export default function ConfigCustomHooksSection({
  config,
  canManage,
  lineage,
}: {
  config: ConfigInterface;
  canManage: boolean;
  // Family + mixin nodes, for resolving which ancestors' config hooks apply
  // to this config.
  lineage?: { key: string; parentKey: string | null; extendsKeys?: string[] }[];
}) {
  const ancestorKeys = useMemo(() => {
    const byKey = new Map(
      (lineage ?? []).map((n) => [
        n.key,
        { parent: n.parentKey ?? undefined, extends: n.extendsKeys },
      ]),
    );
    return getConfigAncestorKeys(
      { parent: config.parent, extends: config.extends },
      byKey,
    );
  }, [lineage, config.parent, config.extends]);

  // This config's position in its lineage — passed to the hook test prefill so
  // it mirrors what hooks receive at runtime.
  const configLineage = useMemo(() => {
    const nodes = (lineage ?? []).map((n) => ({
      key: n.key,
      parent: n.parentKey ?? undefined,
      extends: n.extendsKeys,
    }));
    const ancestors = [...ancestorKeys];
    const descendants = getConfigSubtree(config.key, nodes).filter(
      (k) => k !== config.key,
    );
    return {
      ancestors,
      descendants,
      hasParent: ancestors.length > 0,
      hasChildren: descendants.length > 0,
      isRoot: ancestors.length === 0,
      isLeaf: descendants.length === 0,
    };
  }, [ancestorKeys, lineage, config.key]);

  return (
    <CustomHooksSection
      scope={{
        entityType: "config",
        entityId: config.key,
        label: "Config + descendants",
      }}
      projects={[config.project || ""]}
      description="Run sandboxed JavaScript validation before this Config is published."
      canManage={canManage}
      modalProps={{
        config: {
          key: config.key,
          project: config.project,
          name: config.name,
          value: config.value,
          schema: config.schema,
          lineage: configLineage,
        },
      }}
      inherited={{
        title: "Parent Config Hooks",
        description:
          "Inherited from an ancestor Config (scoped to descendants). These run on this Config's changes but are managed from the parent.",
        entityIds: ancestorKeys,
        column: {
          header: "Parent Config",
          width: "260px",
          render: (h) => (
            <Link href={`/configs/${h.entityId}`}>{h.entityId}</Link>
          ),
        },
      }}
    />
  );
}
