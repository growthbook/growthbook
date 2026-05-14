import React, { useMemo } from "react";
import { FaExclamationCircle, FaRecycle } from "react-icons/fa";
import {
  FaRegCircleQuestion,
  FaRegCircleCheck,
  FaRegCircleXmark,
} from "react-icons/fa6";
import { PiArrowSquareOut } from "react-icons/pi";
import clsx from "clsx";
import { Box } from "@radix-ui/themes";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { featureStatusColors } from "@/components/Features/FeaturesOverview";

export interface FeatureOptionMeta {
  conditional: boolean;
  cyclic: boolean;
  wouldBeCyclic: boolean;
  disabled: boolean;
  deterministicLive: boolean;
  deterministicNotLive: boolean;
  deterministicFalse: boolean;
}

interface FeatureOption {
  label: string;
  value: string;
  meta: FeatureOptionMeta;
  project: string;
  projectName: string | null | undefined;
}

interface Props {
  value: string;
  onChange: (featureId: string) => void;
  featureOptions: FeatureOption[];
  featureProject: string;
  environments: string[];
  hasSDKWithPrerequisites: boolean;
  disabled?: boolean;
}

export default function PrerequisiteFeatureSelector({
  value,
  onChange,
  featureOptions,
  featureProject,
  environments,
  hasSDKWithPrerequisites,
  disabled,
}: Props) {
  const featureOptionsInProject = useMemo(
    () => featureOptions.filter((f) => (f.project || "") === featureProject),
    [featureOptions, featureProject],
  );

  const featureOptionsInOtherProjects = useMemo(
    () => featureOptions.filter((f) => (f.project || "") !== featureProject),
    [featureOptions, featureProject],
  );

  const groupedFeatureOptions: (GroupedValue & {
    options: (SingleValue & { meta?: FeatureOptionMeta })[];
  })[] = useMemo(() => {
    const groups: (GroupedValue & {
      options: (SingleValue & { meta?: FeatureOptionMeta })[];
    })[] = [];

    const projectGroupOptions = featureOptionsInProject.map((f) => ({
      label: f.label,
      value: f.value,
      meta: f.meta,
    }));

    groups.push({
      label: featureProject === "" ? "In no project" : "In this project",
      options: projectGroupOptions,
    });

    if (featureOptionsInOtherProjects.length > 0) {
      groups.push({
        label: "In other projects",
        options: featureOptionsInOtherProjects.map((f) => ({
          label: f.label,
          value: f.value,
          meta: f.meta,
        })),
      });
    }

    return groups;
  }, [featureOptionsInProject, featureOptionsInOtherProjects, featureProject]);

  return (
    <SelectField
      disabled={disabled}
      placeholder="Select feature"
      options={groupedFeatureOptions}
      value={value}
      onChange={(v) => {
        const meta = featureOptions.find((o) => o.value === v)?.meta;
        if (meta?.disabled) return;
        onChange(v);
      }}
      sort={false}
      formatOptionLabel={(option, { context }) => {
        const optionValue = option.value;
        const label = option.label;
        const foundOption = featureOptions.find((o) => o.value === optionValue);
        const meta = foundOption?.meta;
        const projectName = foundOption?.projectName;
        const isSelectedValue = context === "value" && optionValue;

        return (
          <div
            className={clsx({
              "cursor-disabled": !isSelectedValue && !!meta?.disabled,
            })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              width: "100%",
            }}
          >
            {isSelectedValue ? (
              <Link
                href={`/features/${optionValue}`}
                target="_blank"
                style={{
                  position: "relative",
                  zIndex: 1000,
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <OverflowText
                  maxWidth={180}
                  style={{ opacity: meta?.disabled ? 0.5 : 1 }}
                  title={label}
                >
                  {label}
                </OverflowText>
                <PiArrowSquareOut />
              </Link>
            ) : (
              <OverflowText
                maxWidth={180}
                style={{ opacity: meta?.disabled ? 0.5 : 1 }}
                title={label}
              >
                {label}
              </OverflowText>
            )}
            <div
              style={{
                marginLeft: "auto",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {projectName ? (
                <Box style={{ position: "relative", zIndex: 1000 }}>
                  <Text size="small">
                    <Text color="text-low">Project:</Text>{" "}
                    <Text color="text-high">
                      <OverflowText maxWidth={150} title={projectName}>
                        {projectName}
                      </OverflowText>
                    </Text>
                  </Text>
                </Box>
              ) : (
                <Text color="text-low">no project</Text>
              )}
              {meta?.wouldBeCyclic && (
                <Tooltip
                  flipTheme={false}
                  body={
                    <Text size="small" color="text-high">
                      Selecting this feature would create a cyclic dependency.
                    </Text>
                  }
                  style={{
                    position: "relative",
                    zIndex: 1000,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <FaRecycle style={{ color: featureStatusColors.offMuted }} />
                </Tooltip>
              )}
              {meta?.deterministicLive && (
                <Tooltip
                  flipTheme={false}
                  body={
                    <Text as="div" size="small" color="text-high">
                      This feature is{" "}
                      <strong style={{ color: featureStatusColors.on }}>
                        live
                      </strong>{" "}
                      {environments.length === 1
                        ? "in this environment"
                        : environments.includes("production") ||
                            environments.includes("prod")
                          ? "in production"
                          : "in this environment"}
                      .
                    </Text>
                  }
                  style={{
                    position: "relative",
                    zIndex: 1000,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <FaRegCircleCheck style={{ color: featureStatusColors.on }} />
                </Tooltip>
              )}
              {meta?.deterministicNotLive && (
                <Tooltip
                  flipTheme={false}
                  body={
                    <Text as="div" size="small" color="text-high">
                      This feature is{" "}
                      <strong style={{ color: featureStatusColors.off }}>
                        not live
                      </strong>{" "}
                      {environments.length === 1
                        ? "in this environment"
                        : environments.includes("production") ||
                            environments.includes("prod")
                          ? "in production"
                          : "in this environment"}
                      .
                    </Text>
                  }
                  style={{
                    position: "relative",
                    zIndex: 1000,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <FaRegCircleXmark
                    style={{ color: featureStatusColors.offMuted }}
                  />
                </Tooltip>
              )}
              {meta?.deterministicFalse && (
                <Tooltip
                  flipTheme={false}
                  body={
                    <Text as="div" size="small" color="text-high">
                      This feature is currently serving{" "}
                      <span
                        style={{
                          borderRadius: "var(--radius-2)",
                          padding: "0 var(--space-1)",
                          backgroundColor: "var(--gray-a3)",
                        }}
                      >
                        false
                      </span>{" "}
                      {environments.length === 1
                        ? "in this environment"
                        : environments.includes("production") ||
                            environments.includes("prod")
                          ? "in production"
                          : "in this environment"}
                      .
                    </Text>
                  }
                  style={{
                    position: "relative",
                    zIndex: 1000,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <FaRegCircleXmark
                    style={{ color: featureStatusColors.offMuted }}
                  />
                </Tooltip>
              )}
              {meta?.conditional && (
                <Tooltip
                  flipTheme={false}
                  body={
                    <Text as="div" size="small" color="text-high">
                      This feature is in a{" "}
                      <strong style={{ color: featureStatusColors.warning }}>
                        Schrödinger state
                      </strong>
                      {environments.length > 1 && " in some environments"}.
                      {!hasSDKWithPrerequisites && (
                        <>
                          {" "}
                          None of your SDK Connections in this project support
                          evaluating Schrödinger states.
                        </>
                      )}
                    </Text>
                  }
                  style={{
                    position: "relative",
                    zIndex: 1000,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <FaRegCircleQuestion
                    style={{ color: featureStatusColors.warning }}
                  />
                </Tooltip>
              )}
              {meta?.cyclic && (
                <Tooltip
                  flipTheme={false}
                  body={
                    <Text size="small" color="text-high">
                      This feature has a cyclic dependency.
                    </Text>
                  }
                  style={{
                    position: "relative",
                    zIndex: 1000,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <FaExclamationCircle
                    style={{ color: featureStatusColors.danger }}
                  />
                </Tooltip>
              )}
            </div>
          </div>
        );
      }}
    />
  );
}
