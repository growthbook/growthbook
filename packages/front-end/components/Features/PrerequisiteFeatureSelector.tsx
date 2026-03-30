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
}

export default function PrerequisiteFeatureSelector({
  value,
  onChange,
  featureOptions,
  featureProject,
  environments,
  hasSDKWithPrerequisites,
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
                  body="Selecting this feature would create a cyclic dependency."
                  style={{
                    position: "relative",
                    zIndex: 1000,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <FaRecycle className="text-muted" />
                </Tooltip>
              )}
              {meta?.deterministicLive && (
                <Tooltip
                  body={
                    <>
                      This feature is{" "}
                      <span className="text-success font-weight-bold">
                        live
                      </span>{" "}
                      {environments.length === 1
                        ? "in this environment"
                        : environments.includes("production") ||
                            environments.includes("prod")
                          ? "in production"
                          : "in this environment"}
                      .
                    </>
                  }
                  style={{
                    position: "relative",
                    zIndex: 1000,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <FaRegCircleCheck className="text-success" />
                </Tooltip>
              )}
              {meta?.deterministicNotLive && (
                <Tooltip
                  body={
                    <>
                      This feature is{" "}
                      <span className="text-gray font-weight-bold">
                        not live
                      </span>{" "}
                      {environments.length === 1
                        ? "in this environment"
                        : environments.includes("production") ||
                            environments.includes("prod")
                          ? "in production"
                          : "in this environment"}
                      .
                    </>
                  }
                  style={{
                    position: "relative",
                    zIndex: 1000,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <FaRegCircleXmark className="text-muted" />
                </Tooltip>
              )}
              {meta?.deterministicFalse && (
                <Tooltip
                  body={
                    <>
                      This feature is currently serving{" "}
                      <span className="rounded px-1 bg-light">false</span>{" "}
                      {environments.length === 1
                        ? "in this environment"
                        : environments.includes("production") ||
                            environments.includes("prod")
                          ? "in production"
                          : "in this environment"}
                      .
                    </>
                  }
                  style={{
                    position: "relative",
                    zIndex: 1000,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <FaRegCircleXmark className="text-muted" />
                </Tooltip>
              )}
              {meta?.conditional && (
                <Tooltip
                  body={
                    <>
                      This feature is in a{" "}
                      <span className="text-warning-orange font-weight-bold">
                        Schrödinger state
                      </span>
                      {environments.length > 1 && " in some environments"}.
                      {!hasSDKWithPrerequisites && (
                        <>
                          {" "}
                          None of your SDK Connections in this project support
                          evaluating Schrödinger states.
                        </>
                      )}
                    </>
                  }
                  style={{
                    position: "relative",
                    zIndex: 1000,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <FaRegCircleQuestion className="text-warning-orange" />
                </Tooltip>
              )}
              {meta?.cyclic && (
                <Tooltip
                  body="This feature has a cyclic dependency."
                  style={{
                    position: "relative",
                    zIndex: 1000,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <FaExclamationCircle className="text-danger" />
                </Tooltip>
              )}
            </div>
          </div>
        );
      }}
    />
  );
}
