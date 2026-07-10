import React, { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import { ConfigKeyImplementation } from "@/hooks/useConstantReferences";
import {
  dedupeImplementations,
  FeatureUsageTable,
  ExperimentUsageTable,
} from "./ConfigUsageTable";

function GroupLabel({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Heading as="h4" size="x-small" mb="2">
      {children}
    </Heading>
  );
}

// The feature-rule / default-value and experiment references that override keys
// of this config, rendered as full tables below the editor. Tabs toggle between
// a flat by-reference view and per-key sections.
export default function ConfigUsageSection({
  implementations,
  fieldKeys = [],
}: {
  implementations: ConfigKeyImplementation[];
  // Field order, so the "by key" sections match the table above.
  fieldKeys?: string[];
}): React.ReactElement | null {
  const [groupBy, setGroupBy] = useState("reference");

  const deduped = useMemo(
    () => dedupeImplementations(implementations),
    [implementations],
  );
  const featureImpls = useMemo(
    () => deduped.filter((i) => !i.experimentId),
    [deduped],
  );
  const experimentImpls = useMemo(
    () => deduped.filter((i) => i.experimentId),
    [deduped],
  );

  // For the flat "by reference" view, cluster rows by their reference so a
  // feature/experiment's rows sit together (scan order looks random).
  const featureImplsByRef = useMemo(
    () =>
      [...featureImpls].sort(
        (a, b) =>
          a.featureId.localeCompare(b.featureId) ||
          a.keys.join().localeCompare(b.keys.join()),
      ),
    [featureImpls],
  );
  const experimentImplsByRef = useMemo(
    () =>
      [...experimentImpls].sort(
        (a, b) =>
          (a.experimentName ?? a.experimentId ?? "").localeCompare(
            b.experimentName ?? b.experimentId ?? "",
          ) || a.featureId.localeCompare(b.featureId),
      ),
    [experimentImpls],
  );

  // Keys with any usage, ordered by the field order (extras appended sorted).
  const usedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const i of deduped) for (const k of i.keys) set.add(k);
    const ordered = fieldKeys.filter((k) => set.has(k));
    const extras = [...set].filter((k) => !fieldKeys.includes(k)).sort();
    return [...ordered, ...extras];
  }, [deduped, fieldKeys]);

  if (!deduped.length) return null;

  return (
    <Box mt="8" pt="5" style={{ borderTop: "1px solid var(--slate-a4)" }}>
      <Heading as="h3" size="medium" mb="3">
        Usage
      </Heading>

      <Tabs value={groupBy} onValueChange={setGroupBy}>
        <TabsList>
          <TabsTrigger value="reference">By reference</TabsTrigger>
          <TabsTrigger value="key">By key</TabsTrigger>
        </TabsList>

        <TabsContent value="reference">
          <Flex direction="column" gap="5" pt="4">
            {featureImplsByRef.length > 0 && (
              <Box>
                <GroupLabel>Feature rules &amp; defaults</GroupLabel>
                <FeatureUsageTable
                  implementations={featureImplsByRef}
                  showKeys
                />
              </Box>
            )}
            {experimentImplsByRef.length > 0 && (
              <Box>
                <GroupLabel>Experiments</GroupLabel>
                <ExperimentUsageTable
                  implementations={experimentImplsByRef}
                  showKeys
                />
              </Box>
            )}
          </Flex>
        </TabsContent>

        <TabsContent value="key">
          <Flex direction="column" gap="5" pt="4">
            {usedKeys.map((key) => {
              const f = featureImpls.filter((i) => i.keys.includes(key));
              const e = experimentImpls.filter((i) => i.keys.includes(key));
              return (
                <Box key={key}>
                  <GroupLabel>
                    <code
                      style={{ color: "var(--slate-12)", fontSize: "inherit" }}
                    >
                      {key}
                    </code>
                  </GroupLabel>
                  <Flex direction="column" gap="3">
                    {f.length > 0 && <FeatureUsageTable implementations={f} />}
                    {e.length > 0 && (
                      <ExperimentUsageTable implementations={e} />
                    )}
                  </Flex>
                </Box>
              );
            })}
          </Flex>
        </TabsContent>
      </Tabs>
    </Box>
  );
}
