import React from "react";
import {
  PiLinkBreak,
  PiWarningFill,
  PiWarningOctagonFill,
} from "react-icons/pi";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
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
        aria-label={t`Field notes`}
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
        .{" "}
        <Plural
          value={issues.length}
          one="Publishing fails until it's fixed."
          other="Publishing fails until they're fixed."
        />
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
  return {
    severity: allowsExtra ? 0 : 2,
    color: allowsExtra ? "var(--slate-9)" : "var(--amber-11)",
    icon: <PiLinkBreak size={size} />,
    message: (
      <>
        <Trans>
          Not in the schema: <KeyList keys={keys} inverted />.
        </Trans>{" "}
        {allowsExtra ? (
          <Plural
            value={keys.length}
            one="Still served, but unchecked, and validation rules see it as null."
            other="Still served, but unchecked, and validation rules see them as null."
          />
        ) : (
          <Plural
            value={keys.length}
            one="Extra fields aren't allowed, so publishing fails until you remove it or add it to a schema."
            other="Extra fields aren't allowed, so publishing fails until you remove them or add them to a schema."
          />
        )}
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
    message: one ? (
      <Trans>
        <ConfigNames names={descendants} /> also defines this field. After
        publishing, it uses this one instead and keeps its value.
      </Trans>
    ) : (
      <Trans>
        <ConfigNames names={descendants} /> also define this field. After
        publishing, they use this one instead and keep their values.
      </Trans>
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
        {one ? (
          <Trans>
            <ConfigName name={name} /> also defines <KeyList keys={keys} />.
            After publishing, it uses this Config&apos;s definition instead and
            keeps its value.
          </Trans>
        ) : (
          <Trans>
            <ConfigName name={name} /> also defines <KeyList keys={keys} />.
            After publishing, it uses this Config&apos;s definitions instead and
            keeps its values.
          </Trans>
        )}
      </Callout>
    );
  }
  const list = (
    <>
      {descendants.map((d, i) => (
        <React.Fragment key={i}>
          {i > 0 && ", "}
          <ConfigName name={d.name} /> (<KeyList keys={d.keys} />)
        </React.Fragment>
      ))}
    </>
  );
  return (
    <Callout status="info" mt="3">
      <Trans>
        {list} also define these fields. After publishing, they use this
        Config&apos;s definitions instead and keep their values.
      </Trans>
    </Callout>
  );
}

// Descendants a draft would leave with values that don't match the schema.
export function DescendantImpactCallout({ nodes }: { nodes: LineageNode[] }) {
  if (!nodes.length) return null;
  const list = (
    <>
      {nodes.map((n, i) => (
        <React.Fragment key={n.key}>
          {i > 0 && "; "}
          <ConfigName name={n.name} /> (
          {!!n.orphanedFields?.length && (
            <Trans>
              undeclared <KeyList keys={n.orphanedFields} />
            </Trans>
          )}
          {!!n.orphanedFields?.length && !!n.incompatibleFields?.length && "; "}
          {!!n.incompatibleFields?.length && (
            <Trans>
              wrong type <KeyList keys={n.incompatibleFields} />
            </Trans>
          )}
          )
        </React.Fragment>
      ))}
    </>
  );
  return (
    <Callout status="warning" mt="3">
      <Trans>
        Publishing leaves descendant values that won&apos;t match the schema:{" "}
        {list}. You&apos;ll be asked to confirm.
      </Trans>
    </Callout>
  );
}

// How another Config relates to this one, as it reads in a list.
const RELATION_LABELS: Record<ConfigRelation, MessageDescriptor> = {
  child: msg`child`,
  descendant: msg`descendant`,
  parent: msg`parent`,
  ancestor: msg`ancestor`,
  sibling: msg`sibling`,
  related: msg`related`,
};

// One Config failing its validation rules, opening with how it relates to
// this one.
function SingleRuleFailure({
  relation,
  link,
  count,
  ruleNames,
}: {
  relation: ConfigRelation;
  link: React.ReactNode;
  count: number;
  ruleNames: string;
}) {
  switch (relation) {
    case "child":
      return (
        <Trans>
          Child Config {link} fails validation{" "}
          <Plural value={count} one="rule" other="rules" /> {ruleNames}.
        </Trans>
      );
    case "descendant":
      return (
        <Trans>
          Descendant Config {link} fails validation{" "}
          <Plural value={count} one="rule" other="rules" /> {ruleNames}.
        </Trans>
      );
    case "parent":
      return (
        <Trans>
          Parent Config {link} fails validation{" "}
          <Plural value={count} one="rule" other="rules" /> {ruleNames}.
        </Trans>
      );
    case "ancestor":
      return (
        <Trans>
          Ancestor Config {link} fails validation{" "}
          <Plural value={count} one="rule" other="rules" /> {ruleNames}.
        </Trans>
      );
    case "sibling":
      return (
        <Trans>
          Sibling Config {link} fails validation{" "}
          <Plural value={count} one="rule" other="rules" /> {ruleNames}.
        </Trans>
      );
    case "related":
      return (
        <Trans>
          Related Config {link} fails validation{" "}
          <Plural value={count} one="rule" other="rules" /> {ruleNames}.
        </Trans>
      );
  }
}

// Other Configs in the family that fail their validation rules, each named by
// how it relates to this one and linked to where it's fixed.
export function FamilyRuleFailuresCallout({
  failures,
}: {
  failures: { node: LineageNode; relation: ConfigRelation }[];
}) {
  const { i18n } = useLingui();
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
    return (
      <Callout status="warning" mt="3">
        <SingleRuleFailure
          relation={relation}
          link={configLink(node)}
          count={node.invariantViolations?.length ?? 0}
          ruleNames={rules(node)}
        />
      </Callout>
    );
  }
  const list = (
    <>
      {failures.map(({ node, relation }, i) => (
        <React.Fragment key={node.key}>
          {i > 0 && "; "}
          {i18n._(RELATION_LABELS[relation])} {configLink(node)} ({rules(node)})
        </React.Fragment>
      ))}
    </>
  );
  return (
    <Callout status="warning" mt="3">
      <Trans>Other Configs in this family fail validation rules: {list}.</Trans>
    </Callout>
  );
}
