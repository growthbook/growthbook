import React, { useMemo, useState } from "react";
import { Box } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import { ConfigKeyImplementation } from "@/hooks/useConstantReferences";
import {
  dedupeImplementations,
  ByKeyUsageTable,
  ByReferenceUsageTable,
  DedupedImplementation,
} from "./ConfigUsageTable";

// The feature-rule / default-value and experiment references that override keys
// of this config, rendered as full tables below the editor. Tabs toggle between
// grouping by reference (feature) and by key.
export default function ConfigUsageSection({
  implementations,
  fieldKeys = [],
}: {
  implementations: ConfigKeyImplementation[];
  // Field order, so the "by key" sections match the table above.
  fieldKeys?: string[];
}): React.ReactElement | null {
  const [groupBy, setGroupBy] = useState("key");

  // Scope to THIS config's own fieldset: a family member (e.g. a config that
  // mixes this one in) may also override its own unrelated keys — we only show
  // overrides of keys this config actually declares. Configs without a declared
  // fieldset fall back to showing everything.
  const deduped = useMemo(() => {
    const all = dedupeImplementations(implementations);
    if (!fieldKeys.length) return all;
    const set = new Set(fieldKeys);
    return all
      .map((i) => ({ ...i, keys: i.keys.filter((k) => set.has(k)) }))
      .filter((i) => i.keys.length > 0);
  }, [implementations, fieldKeys]);

  // "By reference": group rows under their feature (the referencing flag).
  const featureGroups = useMemo(() => {
    const map = new Map<string, DedupedImplementation[]>();
    for (const i of deduped) {
      const arr = map.get(i.featureId);
      if (arr) arr.push(i);
      else map.set(i.featureId, [i]);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([featureId, impls]) => ({ featureId, impls }));
  }, [deduped]);

  // Keys with any usage, ordered by the field order.
  const usedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const i of deduped) for (const k of i.keys) set.add(k);
    // A schemaless/extensible config declares no fieldKeys — fall back to the
    // keys actually used (first-seen order) so the "By key" tab isn't empty
    // despite real usage (mirrors the `deduped` fallback above).
    if (!fieldKeys.length) return [...set];
    return fieldKeys.filter((k) => set.has(k));
  }, [deduped, fieldKeys]);

  // "By key": one group per used key, with the references that touch it.
  const keyGroups = useMemo(
    () =>
      usedKeys.map((key) => ({
        key,
        impls: deduped.filter((i) => i.keys.includes(key)),
      })),
    [usedKeys, deduped],
  );

  if (!deduped.length) return null;

  return (
    <Box>
      <Heading as="h3" size="medium" mb="1">
        Usage
      </Heading>
      <Text as="p" size="medium" color="text-low" mb="4">
        Feature rules and default values that override this config&apos;s keys.
      </Text>

      <Tabs value={groupBy} onValueChange={setGroupBy}>
        <TabsList>
          <TabsTrigger value="key">By key</TabsTrigger>
          <TabsTrigger value="reference">By reference</TabsTrigger>
        </TabsList>

        <TabsContent value="reference">
          <Box pt="4">
            <ByReferenceUsageTable
              groups={featureGroups}
              keyOrder={fieldKeys}
            />
          </Box>
        </TabsContent>

        <TabsContent value="key">
          <Box pt="4">
            <ByKeyUsageTable groups={keyGroups} />
          </Box>
        </TabsContent>
      </Tabs>
    </Box>
  );
}
