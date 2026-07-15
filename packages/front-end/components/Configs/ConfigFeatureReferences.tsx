import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiFlag, PiDotOutline } from "react-icons/pi";
import { LineageNode } from "@/components/Configs/fieldSchema";
import { ConfigFamilyReferences } from "@/hooks/useConstantReferences";
import LoadingSpinner from "@/components/LoadingSpinner";
import HelperText from "@/ui/HelperText";
import styles from "./ConfigFeatureReferences.module.scss";

const ROW_HEIGHT = 30;
const GUIDE_COLOR = "var(--slate-a6)";

// Horizontal connector stub joining a row to its parent's vertical guide.
function Connector(): React.ReactElement {
  return (
    <Box
      style={{
        position: "absolute",
        left: -5,
        top: ROW_HEIGHT / 2,
        width: 5,
        height: 1,
        background: GUIDE_COLOR,
      }}
    />
  );
}

// Indented child group with a vertical guide line down its left edge.
function Branch({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Box
      style={{
        marginLeft: 6,
        paddingLeft: 5,
        borderLeft: `1px solid ${GUIDE_COLOR}`,
      }}
    >
      {children}
    </Box>
  );
}

// Inverted lineage view: each feature is a root, with the config backing its
// default value ("based on") and a "rules" group of rule configs that differ
// from the base.
//
//   <f> flagname
//     |-- based on
//     |    {} defaultConfig
//     |-- rules
//          {} ruleConfig
export default function ConfigFeatureReferences({
  lineage,
  currentKey,
  references,
  loading,
  error = false,
}: {
  lineage: LineageNode[];
  currentKey: string;
  references: ConfigFamilyReferences | null;
  loading: boolean;
  error?: boolean;
}): React.ReactElement {
  const nodeOf = (key: string) => lineage.find((n) => n.key === key);

  if (loading && !references) {
    return (
      <Flex align="center" gap="2" py="2" style={{ color: "var(--slate-11)" }}>
        <LoadingSpinner />
        <span style={{ fontSize: "var(--font-size-1)" }}>Loading…</span>
      </Flex>
    );
  }

  // Distinguish a failed lookup from a genuine no-references result — otherwise
  // an errored fetch reads as "nothing references this," which is misleading.
  if (error && !references) {
    return (
      <HelperText status="error">
        Couldn&apos;t load references. Try refreshing.
      </HelperText>
    );
  }

  if (!references?.features.length) {
    return (
      <span
        style={{ fontSize: "var(--font-size-1)", color: "var(--slate-10)" }}
      >
        No features reference this config family.
      </span>
    );
  }

  const configRow = (key: string) => {
    const node = nodeOf(key);
    const isCurrent = key === currentKey;
    return (
      <Flex
        key={key}
        align="center"
        gap="1"
        pl="1"
        pr="2"
        className={styles.row}
        onClick={
          isCurrent
            ? undefined
            : (e) => {
                e.stopPropagation();
                window.open(`/configs/${key}`, "_blank", "noopener,noreferrer");
              }
        }
        style={{
          height: ROW_HEIGHT,
          borderRadius: "var(--radius-2)",
          cursor: isCurrent ? "default" : "pointer",
          background: isCurrent ? "var(--violet-a3)" : undefined,
        }}
      >
        <Flex
          align="center"
          justify="center"
          style={{
            width: 14,
            flexShrink: 0,
            color: isCurrent ? "var(--violet-11)" : "var(--slate-11)",
          }}
        >
          <PiDotOutline size={20} />
        </Flex>
        <span
          title={node?.name ?? key}
          style={{
            flex: 1,
            minWidth: 0,
            marginLeft: 4,
            fontSize: "var(--font-size-1)",
            fontWeight: isCurrent ? 500 : 400,
            color: isCurrent ? "var(--violet-11)" : undefined,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node?.name ?? key}
        </span>
      </Flex>
    );
  };

  const groupLabel = (label: string) => (
    <Box style={{ position: "relative" }}>
      <Connector />
      <Flex align="center" pl="1" style={{ height: ROW_HEIGHT }}>
        <span
          style={{ fontSize: "var(--font-size-1)", color: "var(--slate-10)" }}
        >
          {label}
        </span>
      </Flex>
    </Box>
  );

  return (
    <Box>
      {references.features.map((f) => (
        <Box key={f.id} mb="2">
          <Flex
            align="center"
            gap="1"
            pl="1"
            pr="2"
            className={styles.row}
            onClick={() =>
              window.open(`/features/${f.id}`, "_blank", "noopener,noreferrer")
            }
            style={{
              height: ROW_HEIGHT,
              borderRadius: "var(--radius-2)",
              cursor: "pointer",
            }}
          >
            <Flex
              align="center"
              justify="center"
              style={{ width: 14, flexShrink: 0, color: "var(--slate-11)" }}
            >
              <PiFlag size={13} />
            </Flex>
            <span
              title={f.name}
              style={{
                minWidth: 0,
                marginLeft: 4,
                fontSize: "var(--font-size-1)",
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {f.name}
            </span>
          </Flex>
          <Branch>
            {f.defaultConfigKey && (
              <Box>
                {groupLabel("based on")}
                {configRow(f.defaultConfigKey)}
              </Box>
            )}
            {f.ruleConfigKeys.length > 0 && (
              <Box>
                {groupLabel("rules")}
                {f.ruleConfigKeys.map((key) => configRow(key))}
              </Box>
            )}
          </Branch>
        </Box>
      ))}
    </Box>
  );
}
