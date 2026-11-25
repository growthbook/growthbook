import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { UseFormReturn } from "react-hook-form";
import {
  QA_OVERRIDE_TARGETING_KINDS,
  QA_OVERRIDE_WHERE_KINDS,
  QaOverrideFilterKind,
  QaOverrideFormValues,
} from "@/services/qaOverrides";
import Link from "@/ui/Link";
import MultiSelectField from "@/ui/MultiSelectField";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/ui/Tooltip";
import ConditionInput from "@/components/Features/ConditionInput";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";

// `label` names the field, `add` the link that adds it.
const FILTER_COPY: Record<
  QaOverrideFilterKind,
  { label: string; add: string }
> = {
  condition: { label: "Attributes", add: "Target by attribute" },
  savedGroups: { label: "Saved Groups", add: "Target by Saved Group" },
  sdkConnections: { label: "SDK Connections", add: "SDK Connections" },
  projects: { label: "Projects", add: "Projects" },
};

const PROJECTS_NEED_FLAG =
  "Project filters only apply to Feature Flags, and this experiment has none linked.";

function AddLink({
  onClick,
  disabledReason,
  children,
}: {
  onClick: () => void;
  disabledReason?: string;
  children: React.ReactNode;
}) {
  const link = (
    <Link onClick={onClick} disabled={!!disabledReason}>
      <Flex align="center" gap="1">
        <PiPlus />
        {children}
      </Flex>
    </Link>
  );
  if (!disabledReason) return link;
  // A disabled button doesn't report hover, so the wrapper carries the tooltip.
  return (
    <Tooltip content={disabledReason}>
      <span>{link}</span>
    </Tooltip>
  );
}

type Option = { value: string; label: string };

type FieldsProps = {
  form: UseFormReturn<QaOverrideFormValues>;
  addFilter: (kind: QaOverrideFilterKind) => void;
};

// Which SDK Connections receive the override.
export function QaOverrideWhereFields({
  form,
  addFilter,
  removeFilter,
  connectionOptions,
  projectOptions,
  hasStaleConnection,
  projectsNote,
}: FieldsProps & {
  removeFilter: (kind: QaOverrideFilterKind) => void;
  connectionOptions: Option[];
  projectOptions: Option[];
  hasStaleConnection: boolean;
  projectsNote: "neutral" | "warning" | null;
}) {
  const values = form.watch();
  const [justAdded, setJustAdded] = useState<QaOverrideFilterKind | null>(null);
  const available = QA_OVERRIDE_WHERE_KINDS.filter(
    (kind) => !values.filters.includes(kind),
  );
  return (
    <>
      {values.filters
        .filter((k) => QA_OVERRIDE_WHERE_KINDS.includes(k))
        .map((kind) => {
          const field = kind as "sdkConnections" | "projects";
          return (
            // Clearing the field, or leaving it empty, removes it.
            <Box
              key={kind}
              onBlur={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null))
                  return;
                if (form.getValues(field).length === 0) removeFilter(kind);
              }}
            >
              <MultiSelectField
                legacyLabelFormatting={false}
                label={FILTER_COPY[kind].label}
                containerClassName="mb-0"
                value={values[field]}
                onChange={(v, action) => {
                  if (action === "clear") removeFilter(kind);
                  else form.setValue(field, v);
                }}
                options={
                  field === "sdkConnections"
                    ? connectionOptions
                    : projectOptions
                }
                placeholder={
                  field === "sdkConnections"
                    ? "Select SDK Connections…"
                    : "Select Projects…"
                }
                autoFocus={justAdded === kind}
              />
              {field === "sdkConnections" && hasStaleConnection ? (
                <HelperText status="warning" size="sm" mt="1">
                  An SDK Connection that was deleted, archived or moved no
                  longer receives this override.
                </HelperText>
              ) : null}
              {field === "projects" && projectsNote ? (
                <HelperText status={projectsNote} size="sm" mt="1">
                  Project filters only apply to Feature Flags. Visual changes
                  and redirects reach SDK Connections through the
                  experiment&apos;s Project.
                </HelperText>
              ) : null}
            </Box>
          );
        })}
      {!!values.environment && available.length > 0 && (
        <Flex gap="4" mt="1">
          {available.map((kind) => (
            <AddLink
              key={kind}
              disabledReason={
                kind === "projects" && projectsNote === "warning"
                  ? PROJECTS_NEED_FLAG
                  : undefined
              }
              onClick={() => {
                addFilter(kind);
                setJustAdded(kind);
              }}
            >
              {FILTER_COPY[kind].add}
            </AddLink>
          ))}
        </Flex>
      )}
    </>
  );
}

// Who sees the override.
export function QaOverrideTargetingFields({
  form,
  addFilter,
  setFilterActive,
  project,
}: FieldsProps & {
  setFilterActive: (kind: QaOverrideFilterKind, active: boolean) => void;
  project: string;
}) {
  const values = form.watch();
  const available = QA_OVERRIDE_TARGETING_KINDS.filter(
    (kind) => !values.filters.includes(kind),
  );
  return (
    <Flex direction="column" gap="5">
      {values.filters.includes("condition") && (
        <ConditionInput
          slimMode
          label={FILTER_COPY.condition.label}
          defaultValue={values.condition}
          onChange={(v) => {
            form.setValue("condition", v);
            setFilterActive("condition", !!v && v !== "{}");
          }}
          project={project}
        />
      )}
      {values.filters.includes("savedGroups") && (
        <SavedGroupTargetingField
          slimMode
          label={FILTER_COPY.savedGroups.label}
          value={values.savedGroups}
          setValue={(v) => {
            form.setValue("savedGroups", v);
            setFilterActive("savedGroups", v.length > 0);
          }}
          project={project}
        />
      )}
      {available.length > 0 && (
        <Flex gap="4">
          {available.map((kind) => (
            <AddLink key={kind} onClick={() => addFilter(kind)}>
              {FILTER_COPY[kind].add}
            </AddLink>
          ))}
        </Flex>
      )}
    </Flex>
  );
}
