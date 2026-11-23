import { Box, Flex } from "@radix-ui/themes";
import Tooltip from "@/components/Tooltip/Tooltip";
import ValueDisplay from "@/components/Features/ValueDisplay";
import LoadingSpinner from "@/components/LoadingSpinner";
import Text from "@/ui/Text";
import { PrerequisiteStateResult } from "@/hooks/usePrerequisiteStates";
import { featureStatusColors } from "./featureStatusColors";
import StateIcon from "./StateIcon";

export function PrerequisiteStatesCols({
  prereqStates,
  defaultValues, // "true" | "false" defaultValues will override the UI for the "live" state
  envs,
  loading = false,
  colWidth = 120,
  compact = false,
  iconSize = compact ? 14 : 20,
  usePortal = false,
}: {
  prereqStates?: Record<string, PrerequisiteStateResult>;
  defaultValues?: Record<string, string>;
  envs: string[];
  loading?: boolean;
  colWidth?: number;
  compact?: boolean;
  iconSize?: number;
  /** Renders tooltips at the document root, for columns inside a scroll area. */
  usePortal?: boolean;
}) {
  return (
    <>
      {envs.map((env) => {
        const content = (
          <>
            {loading && (
              <Tooltip
                usePortal={usePortal}
                flipTheme={false}
                body={
                  <Text size="sm" color="text-high">
                    Loading prerequisite state...
                  </Text>
                }
              >
                <LoadingSpinner />
              </Tooltip>
            )}
            {!loading &&
              prereqStates?.[env]?.state === "deterministic" &&
              prereqStates?.[env]?.value !== null && (
                <Tooltip
                  usePortal={usePortal}
                  popperClassName="text-left"
                  flipTheme={false}
                  body={
                    <Text as="div" size="sm" color="text-high">
                      {defaultValues?.[env] === undefined && (
                        <>
                          This prerequisite is{" "}
                          <strong style={{ color: featureStatusColors.on }}>
                            live
                          </strong>{" "}
                          in this environment.
                        </>
                      )}
                      {defaultValues?.[env] === "true" && (
                        <>
                          This prerequisite is{" "}
                          <strong style={{ color: featureStatusColors.on }}>
                            live
                          </strong>{" "}
                          and currently serving{" "}
                          <span
                            style={{
                              borderRadius: "var(--radius-2)",
                              padding: "0 var(--space-1)",
                              backgroundColor: "var(--gray-a3)",
                            }}
                          >
                            <ValueDisplay value={"true"} type="boolean" />
                          </span>{" "}
                          in this environment.
                        </>
                      )}
                      {defaultValues?.[env] === "false" && (
                        <>
                          This prerequisite is currently serving{" "}
                          <span
                            style={{
                              borderRadius: "var(--radius-2)",
                              padding: "0 var(--space-1)",
                              backgroundColor: "var(--gray-a3)",
                            }}
                          >
                            <ValueDisplay value={"false"} type="boolean" />
                          </span>{" "}
                          in this environment.
                        </>
                      )}
                    </Text>
                  }
                >
                  <StateIcon
                    state={defaultValues?.[env] === "false" ? "off" : "on"}
                    size={iconSize}
                  />
                </Tooltip>
              )}
            {!loading &&
              prereqStates?.[env]?.state === "deterministic" &&
              prereqStates?.[env]?.value === null && (
                <Tooltip
                  usePortal={usePortal}
                  popperClassName="text-left"
                  flipTheme={false}
                  body={
                    <Text as="div" size="sm" color="text-high">
                      This prerequisite is{" "}
                      <strong style={{ color: featureStatusColors.off }}>
                        not live
                      </strong>{" "}
                      in this environment.
                    </Text>
                  }
                >
                  <StateIcon state="off" size={iconSize} />
                </Tooltip>
              )}
            {!loading && prereqStates?.[env]?.state === "conditional" && (
              <Tooltip
                usePortal={usePortal}
                popperClassName="text-left"
                flipTheme={false}
                body={
                  <Text as="div" size="sm" color="text-high">
                    This prerequisite is in a{" "}
                    <strong style={{ color: featureStatusColors.warning }}>
                      Schrödinger state
                    </strong>{" "}
                    in this environment. We can&apos;t know its value until it
                    is evaluated at runtime in the SDK.
                  </Text>
                }
              >
                <StateIcon state="varies" size={iconSize} />
              </Tooltip>
            )}
            {!loading && prereqStates?.[env]?.state === "cyclic" && (
              <Tooltip
                usePortal={usePortal}
                popperClassName="text-left"
                flipTheme={false}
                body={
                  <Text as="div" size="sm" color="text-high">
                    Circular dependency detected. Please fix.
                  </Text>
                }
              >
                <StateIcon state="cycle" size={iconSize} />
              </Tooltip>
            )}
            {/* No state data is available */}
            {!loading && !prereqStates?.[env] && (
              <Tooltip
                usePortal={usePortal}
                popperClassName="text-left"
                flipTheme={false}
                body={
                  <Text as="div" size="sm" color="text-high">
                    Unable to determine prerequisite state.
                  </Text>
                }
              >
                <StateIcon state="unknown" size={iconSize} />
              </Tooltip>
            )}
          </>
        );

        return (
          <Box key={env} style={{ width: colWidth, flexShrink: 0 }}>
            <Flex justify="center" align="center" py={compact ? "0" : "2"}>
              {content}
            </Flex>
          </Box>
        );
      })}
    </>
  );
}
