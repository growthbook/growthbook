import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import { FaCodeCommit } from "react-icons/fa6";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { ago, date } from "shared/dates";
import React, {
  MutableRefObject,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import stringify from "json-stringify-pretty-compact";
import clsx from "clsx";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import Avatar from "@/components/Avatar/Avatar";
import Code from "@/components/SyntaxHighlighting/Code";
import { useUser } from "@/services/UserContext";

export type MutateLog = {
  mutateLog: () => Promise<void>;
};

export interface Props {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  ref?: MutableRefObject<unknown>;
}

function RevisionLogRow({ log, first }: { log: RevisionLog; first: boolean }) {
  const [open, setOpen] = useState(false);
  const { users } = useUser();

  let value = log.value;
  let valueContainsData = false;
  try {
    const valueAsJson = JSON.parse(log.value);
    value = stringify(valueAsJson);
    valueContainsData = Object.keys(valueAsJson).length > 0;
  } catch (e) {
    // Ignore
    valueContainsData = value.length > 0;
  }
  let comment: string | undefined;
  try {
    comment = JSON.parse(log.value)?.comment;
  } catch (e) {
    // Ignore
  }
  const openContent = () => {
    if (comment) {
      return <div>{comment}</div>;
    } else {
      return valueContainsData ? <Code language="json" code={value} /> : null;
    }
  };
  const statusBackGround = clsx("d-flex p-2 pl-3", {
    "approval-flow-accepted": log.action === "Approved",
    "approval-flow-changes-requested": log.action === "Requested Changes",
    "revision-log-header":
      log.action !== "Approved" && log.action !== "Requested Changes",
    "cursor-pointer ": !(!!comment || !valueContainsData),
  });

  let name = "API";
  if (log.user?.type === "dashboard") {
    name = users.get(log.user.id)?.name ?? "";
  }

  return (
    <div className={`appbox mb-0 ${first ? "" : "mt-3"} revision-log`}>
      <div
        className={statusBackGround}
        onClick={(e) => {
          e.preventDefault();
          if (!(!valueContainsData || !!comment)) {
            setOpen(!open);
          }
        }}
      >
        <h6 className="mb-0">
          {log.action} {log.subject}
        </h6>
        {!(!valueContainsData || !!comment) && (
          <div className="ml-auto">
            {open ? <FaAngleDown /> : <FaAngleRight />}
          </div>
        )}
      </div>
      <div className="p-3">
        {!valueContainsData ||
          (!!comment && <div className="mb-3 ">{openContent()}</div>)}
        {open && openContent()}
        <div className="d-flex">
          {log.user?.type === "dashboard" && (
            <div className="mr-2">
              <Avatar email={log.user.email} size={20} name={name} />
            </div>
          )}
          <div>
            {log.user?.type === "dashboard" ? log.user.name : "API"}{" "}
            <span className="text-muted">{ago(log.timestamp)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const Revisionlog: React.ForwardRefRenderFunction<MutateLog, Props> = (
  { feature, revision },
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
    if (!data) return [];
    const logs = [...data.log];
    logs.sort((a, b) =>
      (b.timestamp as unknown as string).localeCompare(
        a.timestamp as unknown as string,
      ),
    );

    const byDate: Record<string, RevisionLog[]> = {};
    logs.forEach((log) => {
      const d = date(log.timestamp);
      byDate[d] = byDate[d] || [];
      byDate[d].push(log);
    });

    return byDate;
  }, [data]);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  if (!data.log.length) {
    return (
      <p>
        <em>No history for this revision</em>
      </p>
    );
  }

  return (
    <div className="pl-2">
      {Object.entries(logs).map(([date, logs]) => (
        <div className="position-relative pl-3 border-left pt-3" key={date}>
          <div
            style={{
              position: "absolute",
              left: -7,
            }}
          >
            <FaCodeCommit />
          </div>
          <div className="mb-1">{date}</div>
          {logs.map((log, i) => (
            <RevisionLogRow log={log} key={i} first={i === 0} />
          ))}
        </div>
      ))}
    </div>
  );
};
export default React.forwardRef(Revisionlog);
