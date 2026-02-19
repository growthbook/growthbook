import stringify from "json-stringify-pretty-compact";
import { ReactNode, useMemo } from "react";
import { FeaturePrerequisite, SavedGroupTargeting } from "shared/types/feature";
import { isDefined } from "shared/util";
import { SavedGroupWithoutValues } from "shared/types/saved-group";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { Condition, jsonToConds, useAttributeMap } from "@/services/features";
import Tooltip from "@/components/Tooltip/Tooltip";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";

type ConditionWithParentId = Condition & { parentId?: string };

function operatorToText({
  operator,
  isPrerequisite,
  hasMultipleSavedGroups,
  isSavedGroupField,
}: {
  operator: string;
  isPrerequisite?: boolean;
  hasMultipleSavedGroups?: boolean;
  isSavedGroupField?: boolean;
}): string {
  switch (operator) {
    case "$eq":
    case "$veq":
      return `=`;
    case "$ne":
    case "$vne":
      return `≠`;
    case "$includes":
      return `includes`;
    case "$notIncludes":
      return `does not include`;
    case "$empty":
      return `is empty`;
    case "$notEmpty":
      return `is not empty`;
    case "$lt":
    case "$vlt":
      return `<`;
    case "$lte":
    case "$vlte":
      return `≤`;
    case "$gt":
    case "$vgt":
      return `>`;
    case "$gte":
    case "$vgte":
      return `≥`;
    case "$exists":
      return isPrerequisite ? `is live` : `is not NULL`;
    case "$notExists":
      return isPrerequisite ? `is not live` : `is NULL`;
    case "$in":
      return `is any of`;
    case "$nin":
      return `is none of`;
    case "$ini":
      return `is any of (case insensitive)`;
    case "$nini":
      return `is none of (case insensitive)`;
    case "$inGroup":
      return `${isSavedGroupField ? "user " : ""}is in ${hasMultipleSavedGroups ? "all" : "the"} saved group${hasMultipleSavedGroups ? "s" : ""}`;
    case "$notInGroup":
      return `${isSavedGroupField ? "user " : ""}is not in the saved group${hasMultipleSavedGroups ? "s" : ""}`;
    case "$true":
      return "is";
    case "$false":
      return "is";
    case "$regex":
      return `matches the pattern`;
    case "$notRegex":
      return `does not match the pattern`;
    case "$regexi":
      return `matches the pattern (case insensitive)`;
    case "$notRegexi":
      return `does not match the pattern (case insensitive)`;
  }
  return operator;
}

function needsValue(operator: string) {
  return !["$exists", "$notExists", "$empty", "$notEmpty"].includes(operator);
}
function hasMultiValues(operator: string) {
  return ["$in", "$nin", "$ini", "$nini"].includes(operator);
}
function getValue(
  operator: string,
  value: string,
  savedGroups?: SavedGroupWithoutValues[],
): string {
  if (operator === "$true") return "TRUE";
  if (operator === "$false") return "FALSE";

  // Get the groupName from the associated group.id to display a human readable name.
  if ((operator === "$inGroup" || operator === "$notInGroup") && savedGroups) {
    const index = savedGroups.find((i) => i.id === value);
    return index?.groupName || "Group was Deleted";
  }
  return value;
}

const MULTI_VALUE_LIMIT = 3;

export function MultiValuesDisplay({
  values,
  displayMap,
  savedGroupIds,
}: {
  values: string[];
  displayMap?: Record<string, string>;
  savedGroupIds?: Set<string>;
}) {
  const { getSavedGroupById } = useDefinitions();

  return (
    <>
      {values.slice(0, MULTI_VALUE_LIMIT).map((v, i) => {
        const isSavedGroup = savedGroupIds?.has(v);
        const group = isSavedGroup ? getSavedGroupById(v) : null;

        const displayValue =
          isSavedGroup && group
            ? displayMap?.[v] || group.groupName
            : displayMap?.[v] || v;
        return isSavedGroup && group ? (
          <Badge
            key={i}
            color="gray"
            label={
              <Link
                href={`/saved-groups/${group.id}`}
                target="_blank"
                color="violet"
                title={`Manage Saved Group: ${displayValue}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "400px",
                  }}
                >
                  {displayValue}
                </span>
                <PiArrowSquareOut style={{ flexShrink: 0 }} />
              </Link>
            }
          />
        ) : (
          <Badge
            key={i}
            color="gray"
            className="text-ellipsis d-inline-block"
            style={{ maxWidth: 300 }}
            title={displayValue}
            label={
              <Text size="inherit" whiteSpace="pre" color="text-high">
                {displayValue}
              </Text>
            }
          />
        );
      })}
      {values.length > MULTI_VALUE_LIMIT && (
        <Tooltip
          body={
            <div>
              {values.slice(MULTI_VALUE_LIMIT).map((v, i) => {
                const isSavedGroup = savedGroupIds?.has(v);
                const group = isSavedGroup ? getSavedGroupById(v) : null;
                const isLast = i === values.slice(MULTI_VALUE_LIMIT).length - 1;
                return (
                  <span key={i}>
                    {isSavedGroup && group
                      ? group.groupName
                      : displayMap?.[v] || v}
                    {!isLast && ", "}
                  </span>
                );
              })}
            </div>
          }
          usePortal
        >
          <span className="mr-1">
            <em>+ {values.length - MULTI_VALUE_LIMIT} more</em>
          </span>
        </Tooltip>
      )}
    </>
  );
}

function MultiValueDisplay({
  value,
  displayMap,
  noParensForSingleValue = false,
  savedGroupIds,
}: {
  value: string;
  displayMap?: Record<string, string>;
  noParensForSingleValue?: boolean;
  savedGroupIds?: Set<string>;
}) {
  const parts = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const skipParens = noParensForSingleValue && parts.length <= 1;

  if (!parts.length) {
    return (
      <Text>
        <em>empty list</em>
      </Text>
    );
  }
  return (
    <Flex wrap="wrap" gap="2">
      {!skipParens && <Text weight="medium">(</Text>}
      <MultiValuesDisplay
        values={parts}
        displayMap={displayMap}
        savedGroupIds={savedGroupIds}
      />
      {!skipParens && <Text weight="medium">)</Text>}
    </Flex>
  );
}

function getConditionOrParts({
  conditions,
  savedGroups,
  initialAnd = false,
  renderPrerequisite = false,
  keyPrefix = "",
  prefix,
}: {
  conditions: ConditionWithParentId[][];
  savedGroups?: SavedGroupWithoutValues[];
  initialAnd?: boolean;
  renderPrerequisite?: boolean;
  keyPrefix?: string;
  prefix?: ReactNode;
}) {
  if (conditions.length === 0) return [];
  if (conditions.length === 1) {
    return getConditionParts({
      conditions: conditions[0],
      savedGroups,
      initialAnd,
      renderPrerequisite,
      keyPrefix,
      prefix,
    });
  }

  const parts: ReactNode[] = [];

  // Add prefix before OR groups if present and not initialAnd
  if (prefix && !initialAnd) {
    parts.push(<div key={keyPrefix + "prefix"}>{prefix}</div>);
  }

  if (initialAnd) {
    parts.push(
      <div key={keyPrefix + "and-start"}>
        {prefix}
        <Text weight="medium">AND {"["}</Text>
      </div>,
    );
  }

  conditions.forEach((condGroup, i) => {
    if (i > 0) {
      parts.push(
        <Text weight="medium" key={keyPrefix + "or-sep-" + i}>
          OR
        </Text>,
      );
    }

    const groupContent = getConditionParts({
      conditions: condGroup,
      savedGroups,
      initialAnd: false,
      renderPrerequisite,
      keyPrefix: `${keyPrefix}or-${i}-`,
    });

    parts.push(
      <Box
        key={keyPrefix + "or-group-" + i}
        pl="3"
        style={{
          borderLeft: "2px solid var(--gray-6)",
        }}
      >
        <Flex direction="column" gap="2">
          {groupContent}
        </Flex>
      </Box>,
    );
  });

  if (initialAnd) {
    parts.push(
      <div key={keyPrefix + "and-end"}>
        <Text weight="medium">{"]"}</Text>
      </div>,
    );
  }

  return parts;
}

function getConditionParts({
  conditions,
  savedGroups,
  initialAnd = false,
  renderPrerequisite = false,
  keyPrefix = "",
  prefix,
}: {
  conditions: ConditionWithParentId[];
  savedGroups?: SavedGroupWithoutValues[];
  initialAnd?: boolean;
  renderPrerequisite?: boolean;
  keyPrefix?: string;
  prefix?: ReactNode;
}) {
  const isAttributeField = (f: string) =>
    f !== "value" &&
    !f.startsWith("value.") &&
    f !== "$savedGroups" &&
    f !== "$notSavedGroups";

  return conditions.map(({ field, operator, value, parentId }, i) => {
    let fieldEl: ReactNode = isAttributeField(field) ? (
      <Badge
        color="gray"
        label={
          <Link
            href={`/attributes/${encodeURIComponent(field)}`}
            target="_blank"
            color="violet"
            title={`View attribute: ${field}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "400px",
              }}
            >
              {field}
            </span>
            <PiArrowSquareOut style={{ flexShrink: 0 }} />
          </Link>
        }
      />
    ) : (
      <Badge
        color="gray"
        className="text-ellipsis d-inline-block"
        style={{ maxWidth: 300 }}
        title={field}
        label={
          <Text size="inherit" whiteSpace="pre" color="text-high">
            {field}
          </Text>
        }
      />
    );
    let parentIdEl: ReactNode = null;
    if (renderPrerequisite) {
      if (field === "value") {
        fieldEl = null;
      } else if (field.substring(0, 6) === "value.") {
        const displayValue = field.substring(6);
        fieldEl = (
          <Badge
            color="gray"
            className="text-ellipsis d-inline-block"
            style={{ maxWidth: 300 }}
            title={displayValue}
            label={
              <Text size="inherit" whiteSpace="pre" color="text-high">
                {displayValue}
              </Text>
            }
          />
        );
      } else {
        fieldEl = (
          <Tooltip
            className="mr-1 border px-2 alert-danger rounded text-danger"
            body={
              <>
                Prerequisite targeting conditions must reference{" "}
                <code>value</code> as the root element
              </>
            }
          >
            {field}
          </Tooltip>
        );
      }
      if (parentId) {
        parentIdEl = (
          <>
            <Text>prerequisite</Text>
            <ParentIdLink parentId={parentId} />
          </>
        );
      }
    }

    // For saved groups, hide the "field" element and tweak the operator
    if (field === "$savedGroups" || field === "$notSavedGroups") {
      fieldEl = null;
      if (field === "$savedGroups" && operator === "$in") {
        operator = "$inGroup";
      } else if (field === "$notSavedGroups" && operator === "$nin") {
        operator = "$notInGroup";
      }
    }

    const savedGroupValueParts =
      field === "$savedGroups" || field === "$notSavedGroups"
        ? value
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
        : [];
    const hasMultipleSavedGroups = savedGroupValueParts.length > 1;

    // Extract variables for saved group value display
    const group =
      (operator === "$inGroup" || operator === "$notInGroup") && savedGroups
        ? savedGroups.find((sg) => sg.id === value)
        : undefined;
    const displayValue = getValue(operator, value, savedGroups);

    return (
      <Flex wrap="wrap" key={keyPrefix + i} gap="2">
        {i === 0 && prefix}
        {(i > 0 || initialAnd) && <Text weight="medium">AND</Text>}
        {parentIdEl}
        {fieldEl}
        <Text>
          {operatorToText({
            operator,
            isPrerequisite: renderPrerequisite,
            hasMultipleSavedGroups,
            isSavedGroupField:
              field === "$savedGroups" || field === "$notSavedGroups",
          })}
        </Text>
        {field === "$savedGroups" || field === "$notSavedGroups" ? (
          <MultiValueDisplay
            value={value}
            displayMap={Object.fromEntries(
              (savedGroups || []).map((sg) => [sg.id, sg.groupName]),
            )}
            noParensForSingleValue={true}
            savedGroupIds={
              new Set(
                value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              )
            }
          />
        ) : hasMultiValues(operator) ? (
          <MultiValueDisplay value={value} />
        ) : needsValue(operator) ? (
          (operator === "$inGroup" || operator === "$notInGroup") &&
          savedGroups ? (
            group ? (
              <Badge
                color="gray"
                label={
                  <Link
                    href={`/saved-groups/${group.id}`}
                    target="_blank"
                    color="violet"
                    title={`Manage Saved Group: ${group.groupName}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "400px",
                      }}
                    >
                      {group.groupName}
                    </span>
                    <PiArrowSquareOut style={{ flexShrink: 0 }} />
                  </Link>
                }
              />
            ) : (
              <Badge
                color="gray"
                className="text-ellipsis d-inline-block"
                style={{ maxWidth: 300 }}
                title={displayValue}
                label={
                  <Text size="inherit" whiteSpace="pre" color="text-high">
                    {displayValue}
                  </Text>
                }
              />
            )
          ) : (
            <Badge
              color="gray"
              className="text-ellipsis d-inline-block"
              style={{ maxWidth: 300 }}
              title={displayValue}
              label={
                <Text size="inherit" whiteSpace="pre" color="text-high">
                  {displayValue}
                </Text>
              }
            />
          )
        ) : (
          ""
        )}
      </Flex>
    );
  });
}

function ParentIdLink({ parentId }: { parentId: string }) {
  return (
    <Badge
      color="gray"
      className="text-ellipsis d-inline-block"
      style={{ maxWidth: 300 }}
      title={parentId}
      label={
        <Link
          href={`/features/${parentId}`}
          title={`Manage Feature: ${parentId}`}
          target="_blank"
          color="violet"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "400px",
            }}
          >
            {parentId}
          </span>
          <PiArrowSquareOut style={{ flexShrink: 0 }} />
        </Link>
      }
    />
  );
}

export default function ConditionDisplay({
  condition,
  savedGroups: savedGroupTargeting,
  prerequisites,
  project,
  prefix,
}: {
  condition?: string;
  savedGroups?: SavedGroupTargeting[];
  prerequisites?: FeaturePrerequisite[];
  project?: string;
  prefix?: ReactNode;
}) {
  const { savedGroups } = useDefinitions();
  const attributes = useAttributeMap(project);

  const parts: ReactNode[] = [];
  let partId = 0;
  let prefixUsed = false;

  const jsonFormattedCondition = useMemo(() => {
    if (!condition) return;
    try {
      const parsed = JSON.parse(condition);
      return stringify(parsed);
    } catch (e) {
      console.error(e);
      return condition;
    }
  }, [condition]);

  if (savedGroupTargeting && savedGroupTargeting.length > 0) {
    parts.push(
      <SavedGroupTargetingDisplay
        savedGroups={savedGroupTargeting}
        groupClassName="col-auto"
        initialAnd={false}
        key={`${partId++}-saved-group-targeting`}
        prefix={!prefixUsed ? prefix : undefined}
      />,
    );
    prefixUsed = true;
  }

  if (prerequisites) {
    const prereqConditionsGrouped = prerequisites
      .map((p) => {
        const cond = jsonToConds(p.condition);
        if (!cond || cond.length > 1) {
          let jsonFormattedCondition = p.condition;
          try {
            const parsed = JSON.parse(p.condition);
            jsonFormattedCondition = stringify(parsed);
          } catch (e) {
            console.error(e, p.condition);
          }
          parts.push(
            <Flex wrap="wrap" gap="2" key={partId++} className="w-100 col-auto">
              {!prefixUsed && prefix}
              {prefixUsed && <Text weight="medium">AND</Text>}
              <Text>prerequisite</Text>
              <ParentIdLink parentId={p.id} />
              <InlineCode language="json" code={jsonFormattedCondition} />
            </Flex>,
          );
          prefixUsed = true;
          return;
        }
        return cond[0]?.map(({ field, operator, value }) => {
          return {
            field,
            operator,
            value,
            parentId: p.id,
          };
        });
      })
      .filter(isDefined);

    const prereqConds =
      prereqConditionsGrouped.reduce(
        (acc, val) => val && acc.concat(val),
        [],
      ) || [];

    const prereqParts = getConditionParts({
      conditions: prereqConds,
      savedGroups,
      renderPrerequisite: true,
      initialAnd: prefixUsed,
      keyPrefix: `${partId++}-prereq-`,
      prefix: !prefixUsed ? prefix : undefined,
    });
    parts.push(...prereqParts);
    if (prereqParts.length > 0) prefixUsed = true;
  }

  if (condition && jsonFormattedCondition) {
    const conds = jsonToConds(condition);
    // Could not parse into simple conditions
    if (conds === null || !attributes.size) {
      parts.push(
        <div className="w-100" key={partId++}>
          {!prefixUsed && prefix}
          <InlineCode language="json" code={jsonFormattedCondition} />
        </div>,
      );
      prefixUsed = true;
    } else {
      const conditionParts = getConditionOrParts({
        conditions: conds,
        savedGroups,
        keyPrefix: `${partId++}-condition-`,
        initialAnd: prefixUsed,
        prefix: !prefixUsed ? prefix : undefined,
      });
      parts.push(...conditionParts);
      if (conditionParts.length > 0) prefixUsed = true;
    }
  }

  return (
    <Flex direction="column" gap="2">
      {parts}
    </Flex>
  );
}
