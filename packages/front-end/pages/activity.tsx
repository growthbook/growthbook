import { FC, useState } from "react";
import { AuditInterface } from "back-end/types/audit";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import { HistoryTableRow } from "@/components/HistoryTable";
import track from "@/services/track";

const Activity: FC = () => {
  const { data, error } = useApi<{
    events: AuditInterface[];
    experiments: { id: string; name: string }[];
  }>("/activity");

  track("查看活动页面");

  const [open, setOpen] = useState("");

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const nameMap = new Map<string, string>();
  data.experiments.forEach((e) => {
    nameMap.set(e.id, e.name);
  });

  return (
    <div className="container-fluid">
      <h3>活动 - 最近7天</h3>
      <p>包括所有关注的特性和实验。</p>
      {data.events.length > 0 ? (
        <table className="table appbox">
          <thead>
            <tr>
              <th>日期</th>
              <th>类型</th>
              <th>名称</th>
              <th>用户</th>
              <th>事件</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.events.map((event) => (
              <HistoryTableRow
                event={event}
                key={event.id}
                open={open === event.id}
                setOpen={(open) => {
                  setOpen(open ? event.id : "");
                }}
                showName={true}
                showType={true}
                itemName={
                  nameMap.has(event.entity.id)
                    ? nameMap.get(event.entity.id)
                    : undefined
                }
                url={
                  event.entity.object === "feature"
                    ? `/features/${event.entity.id}`
                    : `/${event.entity.object}/${event.entity.id}`
                }
              />
            ))}
          </tbody>
        </table>
      ) : (
        <p>
          <em>近期无事件</em>
        </p>
      )}
    </div>
  );
};

export default Activity;
