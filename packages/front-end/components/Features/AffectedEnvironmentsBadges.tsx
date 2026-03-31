import { Flex } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import { useEnvironments } from "@/services/features";

// Displays "Affected environments:" followed by per-environment badges.
// Resolves "all" to real env IDs via useEnvironments() when allEnvironments
// is not provided. Pass gatedEnvSet to color gated envs amber instead of sky.
export default function AffectedEnvironmentsBadges({
  label = "Affected environments:",
  affectedEnvs,
  allEnvironments: allEnvironmentsProp,
  gatedEnvSet,
}: {
  label?: string;
  affectedEnvs: string[] | "all";
  allEnvironments?: { id: string }[];
  gatedEnvSet?: Set<string> | "all" | "none";
}) {
  const allEnvironmentsFromHook = useEnvironments();
  const allEnvironments = allEnvironmentsProp ?? allEnvironmentsFromHook;

  const envIds =
    affectedEnvs === "all" ? allEnvironments.map((e) => e.id) : affectedEnvs;

  return (
    <Flex align="center" gap="2" wrap="wrap">
      <span
        style={{
          fontSize: "var(--font-size-2)",
          color: "var(--color-text-low)",
        }}
      >
        {label}
      </span>
      {envIds.length === 0 ? (
        <span
          style={{
            fontSize: "var(--font-size-2)",
            color: "var(--color-text-mid)",
            fontStyle: "italic",
          }}
        >
          none
        </span>
      ) : (
        envIds.map((envId) => {
          const isGated =
            gatedEnvSet != null &&
            (gatedEnvSet === "all" ||
              (gatedEnvSet !== "none" && gatedEnvSet.has(envId)));
          return (
            <Badge
              key={envId}
              label={envId}
              color={isGated ? "amber" : "sky"}
              variant="soft"
              radius="small"
            />
          );
        })
      )}
    </Flex>
  );
}
