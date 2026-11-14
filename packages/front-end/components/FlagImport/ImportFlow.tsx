import { ReactNode, useMemo, useState } from "react";
import { Box, Flex, VisuallyHidden } from "@radix-ui/themes";
import { PiArrowRight, PiCaretDown, PiCaretUp } from "react-icons/pi";
import { Environment } from "shared/types/organization";
import {
  FlagImportOverrides,
  FlagImportPreviewFlag,
  FlagImportPreviewRule,
  FlagImportRuleFix,
  planFlagImport,
  previewFlagImport,
  selectFlagImportFlags,
} from "shared/util";
import {
  ApiFlagImport,
  FlagsJson,
  postFlagImportImportValidator,
} from "shared/validators";
import { useAttributeSchema, useEnvironments } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useRestApiCall } from "@/services/restApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import SectionFrame from "@/components/SectionFrame";
import { ActionArrow, CardLink } from "@/components/GetStarted/FeaturedCards";
import ImportRuleCard, { ruleIssueText } from "./ImportRuleCard";

type RuleFixes = NonNullable<FlagImportOverrides["rules"]>;

const NO_PROJECT = "__none__";

const VALUE_TYPES: Record<FlagImportPreviewFlag["valueType"], string> = {
  boolean: "Boolean",
  number: "Number",
  string: "String",
  json: "JSON",
};

export const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

// The rule under each row of a list, as a section's header has.
const rowRule = { boxShadow: "inset 0 -1px 0 0 var(--gray-a4)" };

export function ImportHero({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <Flex direction="column" align="center" gap="2" mb="4">
      {eyebrow}
      <Heading as="h1" size="2xl" align="center" mb="0">
        {title}
      </Heading>
      {children ? (
        <Text as="p" size="lg" color="text-mid" align="center" mb="0">
          {children}
        </Text>
      ) : null}
    </Flex>
  );
}

// The action bar every step ends in.
export function ImportDock({
  left,
  children,
}: {
  left?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box position="sticky" bottom="4" mt="4" style={{ zIndex: 10 }}>
      <Frame mb="0" py="3" px="5" style={{ boxShadow: "var(--shadow-3)" }}>
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <Box>{left}</Box>
          <Flex align="center" gap="3">
            {children}
          </Flex>
        </Flex>
      </Frame>
    </Box>
  );
}

// `env` not equal to something reads as every other environment.
function suggestedEnvironments(condition: string, options: string[]): string[] {
  try {
    const parsed: unknown = JSON.parse(condition || "{}");
    const env =
      parsed && typeof parsed === "object" && "env" in parsed
        ? parsed.env
        : null;
    if (env && typeof env === "object") {
      const excluded =
        "$ne" in env
          ? [env.$ne]
          : "$nin" in env && Array.isArray(env.$nin)
            ? env.$nin
            : null;
      if (excluded) return options.filter((o) => !excluded.includes(o));
    }
  } catch {
    // an unreadable condition suggests nothing
  }
  return [];
}

function FixPanel({
  rule,
  number,
  options,
  onFix,
}: {
  rule: FlagImportPreviewRule;
  number: number;
  options: string[];
  onFix: (fix: FlagImportRuleFix) => void;
}) {
  const [picked, setPicked] = useState(
    () => new Set(suggestedEnvironments(rule.condition, options)),
  );
  return (
    <Flex
      direction="column"
      gap="3"
      mb="3"
      p="4"
      style={{ background: "var(--gray-a2)", borderRadius: "var(--radius-2)" }}
    >
      <Text weight="medium">
        {rule.fixable
          ? `Where should rule ${number} run?`
          : `Rule ${number}: ${ruleIssueText(rule.issue ?? "")}`}
      </Text>
      <Flex align="center" gap="2" wrap="wrap">
        {rule.fixable
          ? options.map((env) => (
              <Button
                key={env}
                size="sm"
                variant={picked.has(env) ? "solid" : "outline"}
                aria-pressed={picked.has(env)}
                onClick={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (!next.delete(env)) next.add(env);
                    return next;
                  })
                }
              >
                {env}
              </Button>
            ))
          : null}
        <Box flexGrow="1" />
        <Button
          size="sm"
          variant="ghost"
          color="red"
          onClick={() => onFix({ remove: true })}
        >
          Remove rule
        </Button>
        {rule.fixable ? (
          <Button
            size="sm"
            disabled={!picked.size}
            onClick={() => onFix({ environments: [...picked] })}
          >
            Apply
          </Button>
        ) : null}
      </Flex>
    </Flex>
  );
}

function FlagRow({
  flag,
  exists,
  checked,
  setChecked,
  environments,
  environmentOptions,
  onFix,
  fixed,
  onUndoFix,
  last,
}: {
  flag: FlagImportPreviewFlag;
  exists: boolean;
  checked: boolean;
  setChecked: (checked: boolean) => void;
  environments: Environment[];
  environmentOptions: string[];
  onFix: (ruleIndex: number, fix: FlagImportRuleFix) => void;
  fixed: boolean;
  onUndoFix: () => void;
  last: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [fixing, setFixing] = useState(false);
  const broken = flag.rules.find((rule) => rule.issue);
  const brokenNumber = broken ? flag.rules.indexOf(broken) + 1 : 0;
  const selectable = flag.importable && !exists;

  return (
    <Box style={last ? undefined : rowRule}>
      <Flex align="center" gap="3" py="3" wrap="wrap">
        <Checkbox
          value={selectable && checked}
          setValue={setChecked}
          disabled={!selectable}
          label={<VisuallyHidden>Import {flag.key}</VisuallyHidden>}
        />
        <Box flexGrow="1" minWidth="0">
          <Text as="div" weight="medium" overflowWrap="anywhere">
            {flag.key}
          </Text>
          {exists ? (
            <Text as="div" size="sm" color="text-mid">
              Already in GrowthBook
            </Text>
          ) : flag.importable ? (
            <Text as="div" size="sm" color="text-mid">
              {VALUE_TYPES[flag.valueType]} ·{" "}
              {plural(flag.rules.length, "rule")}
            </Text>
          ) : (
            <HelperText status="warning" size="sm">
              {broken ? "Needs one quick fix" : flag.reason}
            </HelperText>
          )}
        </Box>
        {selectable && flag.rules.some((rule) => rule.experiment) ? (
          <Badge label="Creates a draft experiment" />
        ) : null}
        {!exists && broken ? (
          <Button
            size="sm"
            variant="soft"
            aria-expanded={fixing}
            onClick={() => setFixing(!fixing)}
          >
            Fix
          </Button>
        ) : null}
        {!exists && fixed ? (
          <Button size="sm" variant="ghost" onClick={onUndoFix}>
            Undo fix
          </Button>
        ) : null}
        {flag.rules.length ? (
          <Button
            size="sm"
            variant="ghost"
            icon={open ? <PiCaretUp /> : <PiCaretDown />}
            iconPosition="right"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            Rules
          </Button>
        ) : null}
      </Flex>
      {!exists && broken && fixing ? (
        <FixPanel
          key={broken.index}
          rule={broken}
          number={brokenNumber}
          options={environmentOptions}
          onFix={(fix) => {
            setFixing(false);
            onFix(broken.index, fix);
          }}
        />
      ) : null}
      {open ? (
        <Flex direction="column" gap="3" pb="4">
          {flag.rules.map((rule, i) => (
            <ImportRuleCard
              key={rule.index}
              rule={rule}
              number={i + 1}
              valueType={flag.valueType}
              environments={environments}
            />
          ))}
        </Flex>
      ) : null}
    </Box>
  );
}

export default function ImportFlow({
  token,
  flagImport,
  file,
  onImported,
}: {
  token: string;
  flagImport: ApiFlagImport;
  file: FlagsJson;
  onImported: (flagImport: ApiFlagImport) => void;
}) {
  const restApiCall = useRestApiCall();
  const workspaceEnvironments = useEnvironments();
  const attributeSchema = useAttributeSchema(true);
  const { projects } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const settings = useOrgSettings();

  const [step, setStep] = useState<1 | 2>(1);
  const [fixes, setFixes] = useState<RuleFixes>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [environmentMap, setEnvironmentMap] = useState<Map<string, string>>(
    new Map(),
  );
  const [projectChoice, setProjectChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const existing = useMemo(
    () => new Set(flagImport.existingFlags),
    [flagImport.existingFlags],
  );
  const previews = useMemo(
    () => previewFlagImport(file, { rules: fixes }),
    [file, fixes],
  );
  const selected = previews
    .filter((f) => f.importable && !existing.has(f.key) && !excluded.has(f.key))
    .map((f) => f.key);
  // Counted against the ones that can be picked, so the total can be reached.
  const selectable = previews.filter(
    (f) => f.importable && !existing.has(f.key),
  ).length;
  const selectedKey = selected.join("\n");
  const plan = useMemo(
    () =>
      planFlagImport(selectFlagImportFlags(file, selectedKey.split("\n")), {
        rules: fixes,
      }),
    [file, fixes, selectedKey],
  );

  const workspaceEnvironmentIds = workspaceEnvironments.map((e) => e.id);
  const namedEnvironments = [
    ...new Set(
      previews.flatMap((f) => f.rules.flatMap((r) => r.environments ?? [])),
    ),
  ];
  const environmentOptions = [
    ...new Set([...workspaceEnvironmentIds, ...namedEnvironments]),
  ];
  const environments: Environment[] = [
    ...workspaceEnvironments,
    ...namedEnvironments
      .filter((id) => !workspaceEnvironmentIds.includes(id))
      .map((id) => ({ id, description: "" })),
  ];
  const newAttributes = plan.attributes
    .map((a) => a.property)
    .filter(
      (property) => !attributeSchema.some((a) => a.property === property),
    );

  const projectOptions = projects.filter((p) =>
    permissionsUtil.canViewFeatureModal(p.id),
  );
  const allowNoProject = permissionsUtil.canViewFeatureModal();
  const project =
    projectChoice && projectOptions.some((p) => p.id === projectChoice)
      ? projectChoice
      : allowNoProject
        ? NO_PROJECT
        : (projectOptions[0]?.id ?? NO_PROJECT);

  const needsProject =
    projectOptions.length > 0 &&
    (!allowNoProject || !!settings.requireProjectForFeatures);
  const hasSecondStep = plan.environments.length > 0 || needsProject;
  const importLabel = `Import ${plural(selected.length, "Feature Flag")}`;
  const sender = [
    flagImport.name,
    flagImport.agent && `sent by ${flagImport.agent}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const submit = async () => {
    const mapped = Object.fromEntries(
      plan.environments
        .map((env) => [env, environmentMap.get(env) ?? env])
        .filter(([from, to]) => from !== to),
    );
    const res = await restApiCall(postFlagImportImportValidator, {
      params: { token },
      body: {
        flags: selected,
        ...(Object.keys(mapped).length ? { environments: mapped } : {}),
        ...(Object.keys(fixes).length ? { rules: fixes } : {}),
        ...(project !== NO_PROJECT ? { project } : {}),
      },
    });
    onImported(res.flagImport);
  };

  const importButton = (
    <Button setError={setError} disabled={!selected.length} onClick={submit}>
      {importLabel}
    </Button>
  );

  return (
    <>
      {hasSecondStep ? <VisuallyHidden>Step {step} of 2</VisuallyHidden> : null}
      <Flex justify="center" gap="1" mb="5" aria-hidden>
        {(hasSecondStep ? [1, 2] : [1]).map((n) => (
          <Box
            key={n}
            width="40px"
            height="4px"
            style={{
              borderRadius: "var(--radius-1)",
              background: n <= step ? "var(--accent-9)" : "var(--gray-a5)",
            }}
          />
        ))}
      </Flex>

      {step === 1 ? (
        <>
          <ImportHero
            title={`We Found ${plural(previews.length, "Feature Flag")}`}
          >
            Pick the ones to bring into GrowthBook.
          </ImportHero>
          <SectionFrame
            title="Feature Flags"
            actions={sender ? <Text color="text-mid">{sender}</Text> : null}
            mb="0"
          >
            {previews.map((flag, i) => (
              <FlagRow
                key={flag.key}
                flag={flag}
                exists={existing.has(flag.key)}
                checked={!excluded.has(flag.key)}
                setChecked={(checked) =>
                  setExcluded((prev) => {
                    const next = new Set(prev);
                    if (checked) next.delete(flag.key);
                    else next.add(flag.key);
                    return next;
                  })
                }
                environments={environments}
                environmentOptions={environmentOptions}
                last={i === previews.length - 1}
                fixed={Object.prototype.hasOwnProperty.call(fixes, flag.key)}
                onUndoFix={() =>
                  setFixes((prev) =>
                    Object.fromEntries(
                      Object.entries(prev).filter(([key]) => key !== flag.key),
                    ),
                  )
                }
                onFix={(ruleIndex, fix) =>
                  setFixes((prev) => ({
                    ...prev,
                    [flag.key]: {
                      ...(Object.prototype.hasOwnProperty.call(prev, flag.key)
                        ? prev[flag.key]
                        : {}),
                      [String(ruleIndex)]: fix,
                    },
                  }))
                }
              />
            ))}
          </SectionFrame>
        </>
      ) : (
        <>
          <ImportHero
            title={
              plan.environments.length
                ? "Match Your Environments"
                : "Choose a Project"
            }
          >
            {plan.environments.length
              ? "Rules that name an environment in your code will use these."
              : null}
          </ImportHero>
          <SectionFrame
            title={plan.environments.length ? "Environments" : "Project"}
            mb="0"
          >
            {plan.environments.map((env, i) => (
              <Flex
                key={env}
                align="center"
                gap="4"
                py="3"
                wrap="wrap"
                style={
                  i < plan.environments.length - 1 || needsProject
                    ? rowRule
                    : undefined
                }
              >
                <Box flexGrow="1" flexBasis="120px">
                  <Text mono weight="medium">
                    {env}
                  </Text>
                </Box>
                <PiArrowRight aria-hidden color="var(--gray-9)" />
                <Box flexGrow="2" flexBasis="220px">
                  <Select
                    value={environmentMap.get(env) ?? env}
                    setValue={(value) =>
                      setEnvironmentMap((prev) => new Map(prev).set(env, value))
                    }
                    aria-label={`GrowthBook environment for ${env}`}
                  >
                    {!workspaceEnvironmentIds.includes(env) ? (
                      <SelectItem value={env}>Create {env}</SelectItem>
                    ) : null}
                    {workspaceEnvironmentIds.map((id) => (
                      <SelectItem key={id} value={id}>
                        {id}
                      </SelectItem>
                    ))}
                  </Select>
                </Box>
              </Flex>
            ))}
            {needsProject ? (
              <Box py="3">
                <Select
                  label="Project"
                  value={project}
                  setValue={setProjectChoice}
                >
                  {allowNoProject ? (
                    <SelectItem value={NO_PROJECT}>None</SelectItem>
                  ) : null}
                  {projectOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </Select>
              </Box>
            ) : null}
          </SectionFrame>
        </>
      )}

      {(step === 2 || !hasSecondStep) && newAttributes.length ? (
        <Text as="p" color="text-mid" align="center" mt="4" mb="0">
          {newAttributes.length === 1 ? "The attribute " : "The attributes "}
          <Text mono weight="medium">
            {newAttributes.join(", ")}
          </Text>
          {" will be added too."}
        </Text>
      ) : null}

      {error ? (
        <Callout status="error" mt="4">
          {error}
        </Callout>
      ) : null}

      <ImportDock
        left={
          step === 1 ? (
            <Text color="text-mid">
              {selected.length} of {selectable} selected
            </Text>
          ) : (
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
          )
        }
      >
        {step === 1 && hasSecondStep ? (
          <Button disabled={!selected.length} onClick={() => setStep(2)}>
            Next
          </Button>
        ) : (
          importButton
        )}
      </ImportDock>
    </>
  );
}

export function ImportDone({
  flagImport,
  onGoToFlags,
}: {
  flagImport: ApiFlagImport;
  onGoToFlags: () => void;
}) {
  const results = flagImport.imported?.results ?? [];
  const created = results.filter(
    (r) => r.kind === "feature" && r.status === "created",
  );
  const leftOut = results.filter(
    (r) => r.kind === "feature" && r.status !== "created",
  );
  const experiment = results.find(
    (r) => r.kind === "experiment" && r.status === "created",
  );
  const reportUrl = flagImport.imported?.autoRunUrl ?? null;
  // The stand-in result for an import that stopped early has no key.
  const attempted = results.filter((r) => r.kind === "feature" && r.key).length;

  return (
    <>
      {created.length ? (
        <ImportHero
          eyebrow={<Badge label="Imported" color="green" />}
          title={`${plural(created.length, "Feature Flag")} Imported`}
        >
          {leftOut.length
            ? `${created.length} of ${attempted} were imported. The rest are listed below.`
            : "They have the same rules as your code."}
        </ImportHero>
      ) : (
        <ImportHero
          eyebrow={<Badge label="Not imported" color="red" />}
          title="No Feature Flags Were Imported"
        >
          The reasons are listed below.
        </ImportHero>
      )}
      {created.length ? (
        <SectionFrame title="Feature Flags" mb="4">
          {created.map((r, i) => (
            <Flex
              key={r.key}
              align="center"
              justify="between"
              gap="3"
              py="3"
              style={i < created.length - 1 ? rowRule : undefined}
            >
              <Text weight="medium" overflowWrap="anywhere">
                {r.key}
              </Text>
              <Link href={`/features/${r.key}`}>View</Link>
            </Flex>
          ))}
        </SectionFrame>
      ) : null}
      {leftOut.length ? (
        <Callout status="warning" mb="4">
          <Flex direction="column" gap="1">
            {leftOut.map((r) => (
              <Text as="div" key={r.key}>
                <Text weight="medium">{r.key || "Import"}</Text>
                {r.message ? `: ${r.message}` : " was left out."}
              </Text>
            ))}
          </Flex>
        </Callout>
      ) : null}
      {created.length ? (
        <Flex gap="4" wrap="wrap">
          <NextCard
            href="/sdks"
            title="Connect Your App"
            description="Serve these Feature Flags from GrowthBook"
          />
          <NextCard
            href="/experiments"
            title="Run an Experiment"
            description={
              experiment
                ? `${experiment.key} is ready as a draft`
                : "Test a change before you roll it out"
            }
          />
        </Flex>
      ) : null}
      <ImportDock
        left={
          reportUrl ? <Link href={reportUrl}>View import report</Link> : null
        }
      >
        <Button onClick={onGoToFlags}>Go to Feature Flags</Button>
      </ImportDock>
    </>
  );
}

function NextCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Box flexGrow="1" flexBasis="260px">
      <CardLink href={href} compact>
        <Flex align="center" gap="3">
          <Heading as="h2" size="md" mb="0">
            {title}
          </Heading>
          <ActionArrow />
        </Flex>
        <Text as="div" color="text-mid" mt="1">
          {description}
        </Text>
      </CardLink>
    </Box>
  );
}
