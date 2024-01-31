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
import clsx from "clsx";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import Avatar from "../Avatar/Avatar";
import Code from "../SyntaxHighlighting/Code";

export interface Props {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  commentsOnly?: boolean;
}

function RevisionLogRow({
  log,
  first,
  commentsOnly,
}: {
  log: RevisionLog;
  first: boolean;
  commentsOnly: boolean;
}) {
  const [open, setOpen] = useState(false);

  let value = log.value;
  try {
    value = stringify(JSON.parse(log.value));
  } catch (e) {
    // Ignore
  }
  let comment: string | undefined;
  try {
    comment = JSON.parse(log.value)?.comment;
  } catch (e) {
    // Ignore
  }
  const showCommentInTitle = log.action === "comment" && !!comment;
  const openContent = () => {
    if (commentsOnly && !!comment) {
      return <div>{comment}</div>;
    } else {
      return <Code language="json" code={value} />;
    }
  };
  console.log(commentsOnly);
  const openClickClassNames = clsx("mb-2", "d-flex", {
    "cursor-pointer": !commentsOnly,
  });
  return (
    <div className={`appbox p-2 mb-0 ${first ? "" : "mt-3"}`}>
      <div
        className={openClickClassNames}
        onClick={(e) => {
          e.preventDefault();
          if (!commentsOnly) {
            setOpen(!open);
          }
        }}
      >
        <h3 className="mb-0">
          {showCommentInTitle ? (
            comment
          ) : (
            <>
              {log.action} {log.subject}
            </>
          )}
        </h3>
        {commentsOnly && !!comment && (
          <div className="ml-auto">
            {open ? <FaAngleDown /> : <FaAngleRight />}
          </div>
        )}
      </div>
      {open && openContent()}
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

export default function Revisionlog({
  feature,
  revision,
  commentsOnly,
}: Props) {
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
            <RevisionLogRow
              log={log}
              key={i}
              first={i === 0}
              commentsOnly={commentsOnly}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
