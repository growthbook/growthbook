import { useContext } from "react";
import { Flex, IconButton } from "@radix-ui/themes";
import { PiFileSqlLight, PiWarningFill } from "react-icons/pi";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Tooltip from "@/components/Tooltip/Tooltip";
import CounterBadge from "@/ui/Badge/CounterBadge";
import Button, { Props as ButtonProps } from "@/ui/Button";
import Text, { TextProps } from "@/ui/Text";
import { DashboardSnapshotContext } from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";

interface Props {
  className?: string;
  size?: TextProps["size"];
  weight?: TextProps["weight"];
  buttonProps?: Partial<ButtonProps>;
  hideQueryCount?: boolean;
  iconOnly?: boolean;
}

export default function DashboardViewQueriesButton({
  className,
  size = "medium",
  weight = "semibold",
  buttonProps = {},
  hideQueryCount = false,
  iconOnly = false,
}: Props) {
  const { allQueries, savedQueriesMap, snapshotError, refreshStatus } =
    useContext(DashboardSnapshotContext);
  const savedQueryIds = [...savedQueriesMap.keys()];
  const count = (allQueries ?? []).length + savedQueryIds.length;
  const buttonLabel =
    refreshStatus === "failed" ? "View failed queries" : "View queries";
  return (
    <ViewAsyncQueriesButton
      ctaComponent={(onClick) =>
        iconOnly ? (
          <Tooltip body={buttonLabel} tipPosition="top">
            <span>
              <IconButton
                disabled={count === 0}
                onClick={onClick}
                className={className}
                variant={buttonProps.variant ?? "ghost"}
                color={refreshStatus === "failed" ? "red" : "gray"}
                size="2"
                title={buttonProps.title ?? buttonLabel}
                aria-label={buttonProps["aria-label"] ?? buttonLabel}
              >
                {refreshStatus === "failed" ? (
                  <PiWarningFill aria-hidden />
                ) : (
                  <PiFileSqlLight
                    aria-hidden
                    size={18}
                    color="var(--color-text-mid)"
                  />
                )}
              </IconButton>
            </span>
          </Tooltip>
        ) : (
          <Button
            disabled={count === 0}
            onClick={onClick}
            className={className}
            variant="ghost"
            style={{
              color: refreshStatus === "failed" ? "var(--red-11)" : undefined,
            }}
            title={buttonProps.title ?? buttonLabel}
            aria-label={buttonProps["aria-label"] ?? buttonLabel}
            {...buttonProps}
          >
            <Flex align="center" justify="between">
              <Text weight={weight} size={size}>
                {buttonLabel}
              </Text>
              {refreshStatus === "failed" ? (
                <PiWarningFill />
              ) : !hideQueryCount ? (
                <CounterBadge ml="1" color="neutral" count={count} />
              ) : null}
            </Flex>
          </Button>
        )
      }
      error={snapshotError}
      queries={allQueries.map((q) => q.query) ?? []}
      savedQueries={savedQueryIds}
      icon={null}
      status={refreshStatus}
      hideQueryCount
    />
  );
}
