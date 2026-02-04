import React, { useMemo } from "react";
import { FaExclamationCircle, FaRecycle } from "react-icons/fa";
import { FaRegCircleQuestion } from "react-icons/fa6";
import { PiArrowSquareOut } from "react-icons/pi";
import clsx from "clsx";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import Link from "@/ui/Link";

export interface FeatureOptionMeta {
  conditional: boolean;
  cyclic: boolean;
  wouldBeCyclic: boolean;
  disabled: boolean;
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
      useMultilineLabels={true}
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
                <OverflowText maxWidth={180}>{label}</OverflowText>
                <PiArrowSquareOut />
              </Link>
            ) : (
              <span style={{ opacity: meta?.disabled ? 0.5 : 1 }}>{label}</span>
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
                <OverflowText maxWidth={150} className="text-muted small">
                  project: <strong>{projectName}</strong>
                </OverflowText>
              ) : (
                <em className="text-muted small" style={{ opacity: 0.5 }}>
                  no project
                </em>
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
      formatGroupLabel={({ label }) => {
        return (
          <div
            className={clsx("pt-2 pb-1 text-muted", {
              "border-top":
                label === "In other projects" &&
                featureOptionsInProject.length > 0,
            })}
          >
            {label}
          </div>
        );
      }}
    />
  );
}
