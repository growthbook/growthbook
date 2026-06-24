import React, { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { ConstantInterface } from "shared/types/constant";
import { SchemaField } from "shared/types/feature";
import { parsePlainJSONObject } from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Field from "@/components/Forms/Field";
import ConfigModal from "@/components/Constants/ConfigModal";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Code from "@/components/SyntaxHighlighting/Code";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

type ResolvedField = {
  key: string;
  field: SchemaField | null;
  value: unknown;
  source: string | null;
};
type LineageNode = { key: string; name: string; parentKey: string | null };
type ResolvedResponse = {
  status: number;
  config: ConstantInterface;
  effectiveSchema: SchemaField[];
  fields: ResolvedField[];
  lineage: LineageNode[];
};

// Renders the lineage tree (base → children) recursively, highlighting the
// current config.
function LineageTree({
  nodes,
  parentKey,
  currentKey,
  depth = 0,
}: {
  nodes: LineageNode[];
  parentKey: string | null;
  currentKey: string;
  depth?: number;
}): React.ReactElement {
  const children = nodes.filter((n) => n.parentKey === parentKey);
  return (
    <>
      {children.map((n) => (
        <Box key={n.key}>
          <Box style={{ paddingLeft: depth * 16 }} py="1">
            <Link
              href={`/configs/${n.key}`}
              color={n.key === currentKey ? "violet" : "dark"}
              weight={n.key === currentKey ? "bold" : "regular"}
            >
              {n.name}
            </Link>
          </Box>
          <LineageTree
            nodes={nodes}
            parentKey={n.key}
            currentKey={currentKey}
            depth={depth + 1}
          />
        </Box>
      ))}
    </>
  );
}

export default function ConfigDetailPage(): React.ReactElement {
  const router = useRouter();
  const { apiCall } = useAuth();
  const { cfgid } = router.query;
  const configKey = typeof cfgid === "string" ? cfgid : "";

  const { data, error, mutate } = useApi<ResolvedResponse>(
    `/constants/${configKey}/resolved`,
    { shouldRun: () => !!configKey },
  );

  // Field currently being overridden (inline edit), and the draft JSON text.
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [showCreateChild, setShowCreateChild] = useState(false);

  const config = data?.config;
  const parentKey = useMemo(() => {
    const self = data?.lineage.find((n) => n.key === config?.key);
    return self?.parentKey ?? null;
  }, [data?.lineage, config?.key]);

  if (error) {
    return (
      <Box className="contents container-fluid pagecontents">
        <Text>Could not load config.</Text>
      </Box>
    );
  }
  if (!data || !config) return <LoadingOverlay />;

  const ownValue = (): Record<string, unknown> =>
    parsePlainJSONObject(config.value ?? "") ?? {};

  // Persist a new own-value object (keeps `$extends`), auto-publishing so edits
  // apply immediately while we play with the editor.
  const saveValue = async (next: Record<string, unknown>) => {
    await apiCall(`/constants/${config.id}?autoPublish=1`, {
      method: "PUT",
      body: JSON.stringify({ value: JSON.stringify(next) }),
    });
    await mutate();
  };

  const startOverride = (f: ResolvedField) => {
    setEditError(null);
    setEditText(JSON.stringify(f.value ?? null, null, 2));
    setEditKey(f.key);
  };

  const resetField = async (key: string) => {
    const v = ownValue();
    delete v[key];
    await saveValue(v);
  };

  const submitOverride = async () => {
    if (!editKey) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editText);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Invalid JSON");
      return;
    }
    await saveValue({ ...ownValue(), [editKey]: parsed });
    setEditKey(null);
  };

  return (
    <>
      <PageHead
        breadcrumb={[
          { display: "Configs", href: "/configs" },
          { display: config.name },
        ]}
      />
      <Box className="contents container-fluid pagecontents" mt="2">
        <Flex gap="5" align="start">
          {/* Lineage sidebar */}
          <Box style={{ width: 220, flexShrink: 0 }}>
            <Text size="small" weight="semibold" color="text-low">
              CONFIGS
            </Text>
            <Box mt="2">
              <LineageTree
                nodes={data.lineage}
                parentKey={null}
                currentKey={config.key}
              />
            </Box>
            <Box mt="3">
              <Link onClick={() => setShowCreateChild(true)}>
                + Add override config
              </Link>
            </Box>
          </Box>

          {/* Main */}
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Flex align="center" gap="3" mb="1">
              <Heading as="h1" size="x-large" mb="0">
                {config.name}
              </Heading>
              <Badge
                label={parentKey ? `extends ${parentKey}` : "base config"}
                color="gray"
                variant="soft"
              />
            </Flex>
            <Text as="p" color="text-mid" mb="3">
              {data.effectiveSchema.length} fields ·{" "}
              {data.fields.filter((f) => f.source === config.key).length}{" "}
              overridden here · resolved at request time
            </Text>

            <Callout status="info" mb="4">
              A config doesn&apos;t reach your SDKs on its own — it&apos;s
              instantiated by a feature flag. Reference this config from a flag
              value to deliver it.
            </Callout>

            <Frame>
              <Tabs defaultValue="form">
                <TabsList>
                  <TabsTrigger value="form">Form</TabsTrigger>
                  <TabsTrigger value="json">JSON</TabsTrigger>
                </TabsList>
                <TabsContent value="form">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableColumnHeader>Key</TableColumnHeader>
                        <TableColumnHeader>Value</TableColumnHeader>
                        <TableColumnHeader>Source</TableColumnHeader>
                        <TableColumnHeader>{""}</TableColumnHeader>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.fields.map((f) => {
                        const here = f.source === config.key;
                        return (
                          <TableRow key={f.key}>
                            <TableCell>{f.key}</TableCell>
                            <TableCell>
                              {editKey === f.key ? (
                                <Box style={{ maxWidth: 360 }}>
                                  <Field
                                    textarea
                                    minRows={2}
                                    value={editText}
                                    onChange={(e) =>
                                      setEditText(e.target.value)
                                    }
                                  />
                                  {editError && (
                                    <Text size="small" color="text-mid">
                                      {editError}
                                    </Text>
                                  )}
                                </Box>
                              ) : (
                                <code>{JSON.stringify(f.value)}</code>
                              )}
                            </TableCell>
                            <TableCell>
                              {here ? (
                                <Badge
                                  label="defined here"
                                  color="violet"
                                  variant="soft"
                                />
                              ) : (
                                <Badge
                                  label={f.source ?? "—"}
                                  color="gray"
                                  variant="soft"
                                />
                              )}
                            </TableCell>
                            <TableCell>
                              <Flex gap="2" justify="end">
                                {editKey === f.key ? (
                                  <>
                                    <Button size="xs" onClick={submitOverride}>
                                      Save
                                    </Button>
                                    <Button
                                      size="xs"
                                      variant="ghost"
                                      onClick={() => setEditKey(null)}
                                    >
                                      Cancel
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Link onClick={() => startOverride(f)}>
                                      override
                                    </Link>
                                    {here && (
                                      <Link onClick={() => resetField(f.key)}>
                                        reset
                                      </Link>
                                    )}
                                  </>
                                )}
                              </Flex>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  {data.fields.length === 0 && (
                    <Text color="text-low">No fields yet.</Text>
                  )}
                </TabsContent>
                <TabsContent value="json">
                  <Code
                    language="json"
                    code={config.value || "{}"}
                    expandable={false}
                  />
                </TabsContent>
              </Tabs>
            </Frame>
          </Box>
        </Flex>
      </Box>

      {showCreateChild && (
        <ConfigModal
          parentKey={config.key}
          close={() => setShowCreateChild(false)}
        />
      )}
    </>
  );
}
