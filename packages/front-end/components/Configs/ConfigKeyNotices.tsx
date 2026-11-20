import React from "react";
import {
  PiLinkBreak,
  PiWarningFill,
  PiWarningOctagonFill,
} from "react-icons/pi";
import { ConfigValueIssue } from "shared/util";
import { ConfigRelation, LineageNode } from "@/components/Configs/fieldSchema";
import Tooltip from "@/ui/Tooltip";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { RadixStatusIcon } from "@/ui/HelperText";

function ConfigName({ name }: { name: string }) {
  return (
    <Text weight="semibold" size="inherit">
      {name}
    </Text>
  );
}

function ConfigNames({ names }: { names: string[] }) {
  return (
    <>
      {names.map((n, i) => (
        <React.Fragment key={i}>
          {i > 0 && ", "}
          <ConfigName name={n} />
        </React.Fragment>
      ))}
    </>
  );
}

// Key names, in a ruby that reads on a callout or, inverted, in a tooltip.
export function KeyList({
  keys,
  inverted = false,
}: {
  keys: string[];
  inverted?: boolean;
}) {
  return (
    <>
      {keys.map((k, i) => (
        <React.Fragment key={k}>
          {i > 0 && ", "}
          <span
            style={{
              fontFamily: "var(--code-font-family)",
              fontSize: "0.95em",
              color: inverted ? "var(--ruby-8)" : "var(--ruby-11)",
            }}
          >
            {k}
          </span>
        </React.Fragment>
      ))}
    </>
  );
}

// Something to know about a key, ranked so a row shows only its most severe
// icon while its tooltip lists them all.
export type KeyNotice = {
  severity: number;
  color: string;
  icon: React.ReactNode;
  message: React.ReactNode;
};

export function KeyNoticesIcon({ notices }: { notices: KeyNotice[] }) {
  if (!notices.length) return null;
  const ranked = [...notices].sort((a, b) => b.severity - a.severity);
  return (
    <Tooltip
      content={ranked.map((n, i) => (
        <div key={i} style={i > 0 ? { marginTop: 6 } : undefined}>
          {n.message}
        </div>
      ))}
    >
      <span
        // Focusable, so the tooltip opens from the keyboard too.
        tabIndex={0}
        role="img"
        aria-label="Field notes"
        style={{
          display: "inline-flex",
          flexShrink: 0,
          color: ranked[0].color,
        }}
      >
        {ranked[0].icon}
      </span>
    </Tooltip>
  );
}

export function validationRuleNotice(message: string): KeyNotice {
  return {
    severity: 3,
    color: "var(--amber-11)",
    icon: <PiWarningOctagonFill />,
    message,
  };
}

// A value that doesn't match its field's schema, or a required one that's
// missing.
export function schemaIssuesNotice(issues: ConfigValueIssue[]): KeyNotice {
  return {
    severity: 2,
    color: "var(--amber-11)",
    icon: <PiWarningFill />,
    message: (
      <>
        {issues.map((issue, i) => (
          <React.Fragment key={i}>
            {i > 0 && "; "}
            <KeyList keys={[issue.path]} inverted /> {issue.message}
          </React.Fragment>
        ))}
        . Publishing fails until {issues.length === 1 ? "it's" : "they're"}{" "}
        fixed.
      </>
    ),
  };
}

// Value keys no schema in the family declares.
export function undeclaredKeysNotice(
  keys: string[],
  allowsExtra: boolean,
  size?: number,
): KeyNotice {
  const them = keys.length === 1 ? "it" : "them";
  return {
    severity: allowsExtra ? 0 : 2,
    color: allowsExtra ? "var(--slate-9)" : "var(--amber-11)",
    icon: <PiLinkBreak size={size} />,
    message: (
      <>
        Not in the schema: <KeyList keys={keys} inverted />.{" "}
        {allowsExtra
          ? `Still served, but unchecked, and validation rules see ${them} as null.`
          : `Extra fields aren't allowed, so publishing fails until you remove ${them} or add ${them} to a schema.`}
      </>
    ),
  };
}

// A field this Config now defines that descendants also define. Once
// published, they use this definition and keep their values.
export function reconciledFieldNotice(descendants: string[]): KeyNotice {
  const one = descendants.length === 1;
  return {
    severity: 1,
    color: "var(--violet-11)",
    icon: <RadixStatusIcon status="info" size="sm" />,
    message: (
      <>
        <ConfigNames names={descendants} /> also {one ? "defines" : "define"}{" "}
        this field. After publishing, {one ? "it uses" : "they use"} this one
        instead and {one ? "keeps its value" : "keep their values"}.
      </>
    ),
  };
}

export function ReconciledFieldsCallout({
  descendants,
}: {
  descendants: { name: string; keys: string[] }[];
}) {
  if (!descendants.length) return null;
  if (descendants.length === 1) {
    const [{ name, keys }] = descendants;
    const one = keys.length === 1;
    return (
      <Callout status="info" mt="3">
        <ConfigName name={name} /> also defines <KeyList keys={keys} />. After
        publishing, it uses this Config&apos;s{" "}
        {one ? "definition" : "definitions"} instead and keeps its{" "}
        {one ? "value" : "values"}.
      </Callout>
    );
  }
  return (
    <Callout status="info" mt="3">
      {descendants.map((d, i) => (
        <React.Fragment key={i}>
          {i > 0 && ", "}
          <ConfigName name={d.name} /> (<KeyList keys={d.keys} />)
        </React.Fragment>
      ))}{" "}
      also define these fields. After publishing, they use this Config&apos;s
      definitions instead and keep their values.
    </Callout>
  );
}

// Descendants a draft would leave with values that don't match the schema.
export function DescendantImpactCallout({ nodes }: { nodes: LineageNode[] }) {
  if (!nodes.length) return null;
  return (
    <Callout status="warning" mt="3">
      Publishing leaves descendant values that won&apos;t match the schema:{" "}
      {nodes.map((n, i) => (
        <React.Fragment key={n.key}>
          {i > 0 && "; "}
          <ConfigName name={n.name} /> (
          {!!n.orphanedFields?.length && (
            <>
              undeclared <KeyList keys={n.orphanedFields} />
            </>
          )}
          {!!n.orphanedFields?.length && !!n.incompatibleFields?.length && "; "}
          {!!n.incompatibleFields?.length && (
            <>
              wrong type <KeyList keys={n.incompatibleFields} />
            </>
          )}
          )
        </React.Fragment>
      ))}
      . You&apos;ll be asked to confirm.
    </Callout>
  );
}

// Other Configs in the family that fail their validation rules, each named by
// how it relates to this one and linked to where it's fixed.
export function FamilyRuleFailuresCallout({
  failures,
}: {
  failures: { node: LineageNode; relation: ConfigRelation }[];
}) {
  if (!failures.length) return null;
  const rules = (n: LineageNode) =>
    (n.invariantViolations ?? []).map((v) => `"${v.name}"`).join(", ");
  const configLink = (n: LineageNode) => (
    <Link href={`/configs/${n.key}`}>
      <ConfigName name={n.name} />
    </Link>
  );
  if (failures.length === 1) {
    const [{ node, relation }] = failures;
    const one = (node.invariantViolations?.length ?? 0) === 1;
    return (
      <Callout status="warning" mt="3">
        {relation.charAt(0).toUpperCase() + relation.slice(1)} Config{" "}
        {configLink(node)} fails validation {one ? "rule" : "rules"}{" "}
        {rules(node)}.
      </Callout>
    );
  }
  return (
    <Callout status="warning" mt="3">
      Other Configs in this family fail validation rules:{" "}
      {failures.map(({ node, relation }, i) => (
        <React.Fragment key={node.key}>
          {i > 0 && "; "}
          {relation} {configLink(node)} ({rules(node)})
        </React.Fragment>
      ))}
      .
    </Callout>
  );
}
