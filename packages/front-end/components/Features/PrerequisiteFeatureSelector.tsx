import React, { useMemo } from "react";
import { FaRecycle } from "react-icons/fa";
import clsx from "clsx";
import { Trans, useLingui } from "@lingui/react/macro";
import { Box } from "@radix-ui/themes";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import { Popover } from "@/ui/Popover";
import {
  FeatureOptionForTooltip,
  FeatureOptionWithTooltip,
} from "@/components/Features/FeatureOptionTooltip";
import {
  OptionLabel,
  OptionProjectsLabel,
} from "@/components/Features/OptionTooltipShell";
import Text from "@/ui/Text";
import { featureStatusColors } from "@/components/Features/featureStatusColors";
import StateIcon from "@/components/Features/StateIcon";

export interface FeatureOptionMeta {
  conditional: boolean;
  cyclic: boolean;
  wouldBeCyclic: boolean;
  disabled: boolean;
  deterministicLive: boolean;
  deterministicNotLive: boolean;
  deterministicFalse: boolean;
}

interface FeatureOption extends FeatureOptionForTooltip {
  meta: FeatureOptionMeta;
  project: string;
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
  const { t } = useLingui();
  const inProduction =
    environments.length !== 1 &&
    (environments.includes("production") || environments.includes("prod"));
  // A value the SDK serves, shown as is.
  const falseValue = "false";
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
      label: featureProject === "" ? t`In no project` : t`In this project`,
      options: projectGroupOptions,
    });

    if (featureOptionsInOtherProjects.length > 0) {
      groups.push({
        label: t`In other projects`,
        options: featureOptionsInOtherProjects.map((f) => ({
          label: f.label,
          value: f.value,
          meta: f.meta,
        })),
      });
    }

    return groups;
  }, [
    featureOptionsInProject,
    featureOptionsInOtherProjects,
    featureProject,
    t,
  ]);

  return (
    <SelectField
      disabled={disabled}
      placeholder={t`Select feature`}
      options={groupedFeatureOptions}
      value={value}
      size="legacy"
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
        const targetingProjectNames = foundOption?.targetingProjectNames ?? [];
        const targetingAllProjects = !!foundOption?.targetingAllProjects;
        const isSelectedValue = context === "value" && optionValue;
        const moreCount = targetingProjectNames.length;
        const alsoTargets = targetingProjectNames.join(", ");

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
            <FeatureOptionWithTooltip
              option={foundOption ?? { label, value: optionValue }}
              environments={environments}
              context={isSelectedValue ? "value" : "menu"}
            >
              <OptionLabel
                label={label}
                style={{ opacity: meta?.disabled ? 0.5 : 1 }}
              />
            </FeatureOptionWithTooltip>
            <div
              style={{
                marginLeft: "auto",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: 11,
              }}
            >
              <Box style={{ position: "relative", zIndex: 1000 }}>
                <OptionProjectsLabel
                  names={projectName ? [projectName] : []}
                  extra={
                    <>
                      {!projectName && (
                        <Text size="inherit" color="text-low">
                          <Trans>No Project</Trans>
                        </Text>
                      )}
                      {targetingAllProjects ? (
                        <Text size="inherit" color="text-low">
                          {" "}
                          <Trans>+ All Projects</Trans>
                        </Text>
                      ) : targetingProjectNames.length > 0 ? (
                        <>
                          {" "}
                          <Popover
                            openOnHover
                            anchorOnly
                            side="top"
                            sideOffset={8}
                            // Native span: @/ui/Text drops Slot-injected props
                            // (hover handlers, aria), which makes it an inert
                            // asChild trigger.
                            trigger={
                              <span>
                                <Text size="inherit" color="text-low">
                                  <Trans>+ {moreCount} more</Trans>
                                </Text>
                              </span>
                            }
                            content={
                              <Text size="sm">
                                <Trans>Also targets: {alsoTargets}</Trans>
                              </Text>
                            }
                          />
                        </>
                      ) : null}
                    </>
                  }
                />
              </Box>
              {meta?.wouldBeCyclic && (
                <Tooltip
                  flipTheme={false}
                  body={
                    <Text size="sm" color="text-high">
                      <Trans>
                        Selecting this feature would create a cyclic dependency.
                      </Trans>
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
                    <Text as="div" size="sm" color="text-high">
                      {inProduction ? (
                        <Trans>
                          This feature is{" "}
                          <strong style={{ color: featureStatusColors.on }}>
                            live
                          </strong>{" "}
                          in production.
                        </Trans>
                      ) : (
                        <Trans>
                          This feature is{" "}
                          <strong style={{ color: featureStatusColors.on }}>
                            live
                          </strong>{" "}
                          in this environment.
                        </Trans>
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
                  <StateIcon state="on" />
                </Tooltip>
              )}
              {meta?.deterministicNotLive && (
                <Tooltip
                  flipTheme={false}
                  body={
                    <Text as="div" size="sm" color="text-high">
                      {inProduction ? (
                        <Trans>
                          This feature is{" "}
                          <strong style={{ color: featureStatusColors.off }}>
                            not live
                          </strong>{" "}
                          in production.
                        </Trans>
                      ) : (
                        <Trans>
                          This feature is{" "}
                          <strong style={{ color: featureStatusColors.off }}>
                            not live
                          </strong>{" "}
                          in this environment.
                        </Trans>
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
                  <StateIcon state="off" />
                </Tooltip>
              )}
              {meta?.deterministicFalse && (
                <Tooltip
                  flipTheme={false}
                  body={
                    <Text as="div" size="sm" color="text-high">
                      {inProduction ? (
                        <Trans>
                          This feature is currently serving{" "}
                          <span
                            style={{
                              borderRadius: "var(--radius-2)",
                              padding: "0 var(--space-1)",
                              backgroundColor: "var(--gray-a3)",
                            }}
                          >
                            {falseValue}
                          </span>{" "}
                          in production.
                        </Trans>
                      ) : (
                        <Trans>
                          This feature is currently serving{" "}
                          <span
                            style={{
                              borderRadius: "var(--radius-2)",
                              padding: "0 var(--space-1)",
                              backgroundColor: "var(--gray-a3)",
                            }}
                          >
                            {falseValue}
                          </span>{" "}
                          in this environment.
                        </Trans>
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
                  <StateIcon state="off" />
                </Tooltip>
              )}
              {meta?.conditional && (
                <Tooltip
                  flipTheme={false}
                  body={
                    <Text as="div" size="sm" color="text-high">
                      {environments.length > 1 ? (
                        <Trans>
                          This feature is in a{" "}
                          <strong
                            style={{ color: featureStatusColors.warning }}
                          >
                            Schrödinger state
                          </strong>{" "}
                          in some environments.
                        </Trans>
                      ) : (
                        <Trans>
                          This feature is in a{" "}
                          <strong
                            style={{ color: featureStatusColors.warning }}
                          >
                            Schrödinger state
                          </strong>
                          .
                        </Trans>
                      )}
                      {!hasSDKWithPrerequisites && (
                        <>
                          {" "}
                          <Trans>
                            None of your SDK Connections in this project support
                            evaluating Schrödinger states.
                          </Trans>
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
                  <StateIcon state="varies" />
                </Tooltip>
              )}
              {meta?.cyclic && (
                <Tooltip
                  flipTheme={false}
                  body={
                    <Text size="sm" color="text-high">
                      <Trans>This feature has a cyclic dependency.</Trans>
                    </Text>
                  }
                  style={{
                    position: "relative",
                    zIndex: 1000,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <StateIcon state="cycle" />
                </Tooltip>
              )}
            </div>
          </div>
        );
      }}
    />
  );
}
