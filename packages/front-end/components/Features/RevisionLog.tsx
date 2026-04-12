import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import { FaCodeCommit } from "react-icons/fa6";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { date, datetime } from "shared/dates";
import React, {
  MutableRefObject,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import stringify from "json-stringify-pretty-compact";
import { Box, Flex } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import EventUser from "@/components/Avatar/EventUser";
import Code from "@/components/SyntaxHighlighting/Code";
import Text from "@/ui/Text";

export type MutateLog = {
  mutateLog: () => Promise<void>;
};

export interface Props {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  ref?: MutableRefObject<unknown>;
  reviewOnly?: boolean;
}

const REVIEW_ACTIONS = new Set([
  "Review Requested",
  "Approved",
  "Requested Changes",
  "Comment",
  "edit comment",
]);

function actionColor(action: string): string {
  if (action === "Approved") return "green";
  if (action === "Requested Changes") return "red";
  if (action === "Review Requested") return "orange";
  if (action === "Comment") return "blue";
  return "gray";
}

export function RevisionLogRow({
  log,
  first,
}: {
  log: RevisionLog;
  first: boolean;
}) {
  const [open, setOpen] = useState(false);
  let value = log.value;
  let valueContainsData = false;
  try {
    const valueAsJson = JSON.parse(log.value);
    value = stringify(valueAsJson);
    valueContainsData = Object.keys(valueAsJson).length > 0;
  } catch (e) {
    valueContainsData = value.length > 0;
  }
  let comment: string | undefined;
  try {
    comment = JSON.parse(log.value)?.comment;
  } catch (e) {
    // not JSON
  }

  const hasExpandable = !comment && valueContainsData;

  const color = actionColor(log.action);

  return (
    <Box
      mt={first ? "0" : "4"}
      style={{
        border: `1px solid var(--${color}-a4)`,
        borderRadius: "var(--radius-2)",
        overflow: "hidden",
      }}
    >
      {/* Header row */}
      <Flex
        align="center"
        gap="2"
        px="2"
        py="2"
        style={{
          background: `var(--${color}-a3)`,
          cursor: hasExpandable ? "pointer" : "default",
        }}
        onClick={() => {
          if (hasExpandable) setOpen((o) => !o);
        }}
      >
        <Text size="small" weight="semibold">
          {log.action === "edit comment" ? "Edit revision notes" : log.action}
        </Text>
        {log.subject && (
          <Text size="small" color="text-mid">
            {log.subject}
          </Text>
        )}
        <Flex align="center" gap="1" ml="auto">
          <EventUser
            user={log.user}
            display="avatar-name-email"
            size="sm"
            wrap={true}
          />
          <Text size="small" color="text-low">
            {" · "}
            {datetime(log.timestamp)}
          </Text>
          {hasExpandable && (
            <Text size="small" color="text-low">
              {open ? <FaAngleDown /> : <FaAngleRight />}
            </Text>
          )}
        </Flex>
      </Flex>

      {/* Body: comment always visible; JSON expandable on click */}
      {(comment || open) && (
        <Box p="2">
          {comment && (
            <Text size="small" as="div">
              {comment}
            </Text>
          )}
          {open && !comment && <Code language="json" code={value} />}
        </Box>
      )}
    </Box>
  );
}

const Revisionlog: React.ForwardRefRenderFunction<MutateLog, Props> = (
  { feature, revision, reviewOnly },
  ref,
) => {
  const { data, error, mutate } = useApi<{ log: RevisionLog[] }>(
    `/feature/${feature.id}/${revision.version}/log`,
  );
  useImperativeHandle(ref, () => ({
    async mutateLog() {
      await mutate();
    },
  }));

  const logs = useMemo(() => {
    if (!data) return {};
    const filtered = reviewOnly
      ? data.log.filter((l) => REVIEW_ACTIONS.has(l.action))
      : data.log;
    const sorted = [...filtered].sort((a, b) =>
      (b.timestamp as unknown as string).localeCompare(
        a.timestamp as unknown as string,
      ),
    );

    const byDate: Record<string, RevisionLog[]> = {};
    sorted.forEach((log) => {
      const d = date(log.timestamp);
      byDate[d] = byDate[d] || [];
      byDate[d].push(log);
    });

    return byDate;
  }, [data, reviewOnly]);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  if (!Object.keys(logs).length) {
    return (
      <Text as="p" color="text-low" size="small">
        <em>
          {reviewOnly
            ? "No review activity yet"
            : "No history for this revision"}
        </em>
      </Text>
    );
  }

  return (
    <Box pl="2">
      {Object.entries(logs).map(([d, entries]) => (
        <Box
          key={d}
          pl="3"
          pt="3"
          style={{
            position: "relative",
            borderLeft: "2px solid var(--gray-4)",
          }}
        >
          <Box
            style={{
              position: "absolute",
              left: -7,
              top: 8,
              color: "var(--gray-8)",
            }}
          >
            <FaCodeCommit />
          </Box>
          <Text size="small" weight="semibold" color="text-mid" mb="2" as="div">
            {d}
          </Text>
          {entries.map((log, i) => (
            <RevisionLogRow log={log} key={i} first={i === 0} />
          ))}
        </Box>
      ))}
    </Box>
  );
};
export default React.forwardRef(Revisionlog);
