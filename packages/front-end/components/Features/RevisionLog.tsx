import { FeatureInterface } from "back-end/types/feature";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "back-end/types/feature-revision";
import { FaCodeCommit } from "react-icons/fa6";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { ago, date } from "shared/dates";
import { useMemo, useState } from "react";
import stringify from "json-stringify-pretty-compact";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import Avatar from "@/components/Avatar/Avatar";
import Code from "@/components/SyntaxHighlighting/Code";

export interface Props {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
}

function RevisionLogRow({ log, first }: { log: RevisionLog; first: boolean }) {
  const [open, setOpen] = useState(false);

  let value = log.value;
  try {
    value = stringify(JSON.parse(log.value));
  } catch (e) {
    // Ignore
  }

  return (
    <div className={`appbox p-2 mb-0 ${first ? "" : "mt-3"}`}>
      <div
        className="mb-2 d-flex cursor-pointer"
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
      >
        <h3 className="mb-0">
          {log.action} {log.subject}
        </h3>
        <div className="ml-auto">
          {open ? <FaAngleDown /> : <FaAngleRight />}
        </div>
      </div>
      {open && <Code language="json" code={value} />}
      <div className="d-flex">
        {log.user?.type === "dashboard" && (
          <div className="mr-2">
            <Avatar email={log.user.email} size={20} />
          </div>
        )}
        <div>
          {log.user?.type === "dashboard" ? log.user.name : "API"}{" "}
          <span className="text-muted">{ago(log.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}

export default function Revisionlog({ feature, revision }: Props) {
  const { data, error } = useApi<{ log: RevisionLog[] }>(
    `/feature/${feature.id}/${revision.version}/log`
  );

  const logs = useMemo(() => {
    if (!data) return [];
    const logs = [...data.log];
    logs.sort((a, b) =>
      ((b.timestamp as unknown) as string).localeCompare(
        (a.timestamp as unknown) as string
      )
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
}
