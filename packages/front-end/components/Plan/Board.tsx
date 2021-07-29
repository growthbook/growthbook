import { ReactElement } from "react";
import { ExperimentInterfaceStringDates } from "../../../back-end/types/experiment";
import { BoardInterface } from "../../../back-end/types/board";
import { useMemo } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import Link from "next/link";
import Markdown from "../Markdown/Markdown";

export interface BoardProps {
  experiments: ExperimentInterfaceStringDates[];
}

export default function Board({ experiments }: BoardProps): ReactElement {
  const experimentMap = useMemo(() => {
    const m: Map<string, ExperimentInterfaceStringDates> = new Map();
    experiments.forEach((e) => {
      m.set(e.id, e);
    });
    return m;
  }, [experiments]);

  const { data, error } = useApi<{ board: BoardInterface }>(`/board`);

  if (error) {
    return (
      <div className="alert alert-danger">Failed to fetch board layout</div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const board = data.board;

  const used: Set<string> = new Set();
  board.columns.forEach((col) => {
    col.experiments.forEach((e) => {
      used.add(e);
    });
  });

  return (
    <div
      className="d-flex flex-column h-100 bg-white pt-3"
      style={{ maxHeight: "100%" }}
    >
      <div className="d-flex" style={{ flex: 1, minHeight: 0 }}>
        {board.columns.map((col, i) => {
          // Start with experiment ids that are explicitly in the board
          const expIds = [...col.experiments];

          // Add in any other experiment ids at the end if this is the proper column
          experimentMap.forEach((exp) => {
            if (used.has(exp.id)) return;
            if (exp.archived) {
              if (col.type === "archived") {
                expIds.push(exp.id);
              }
            } else if (exp.status === "stopped") {
              if (col.type === "stopped") {
                expIds.push(exp.id);
              }
            } else if (exp.status === "running") {
              if (col.type === "running") {
                expIds.push(exp.id);
              }
            } else {
              if (col.type === "backlog") {
                expIds.push(exp.id);
              }
            }
          });
          return (
            <div
              className="mx-2 bg-light border rounded d-flex flex-column custom-scroll p-1"
              key={i}
              style={{ flex: 1, minWidth: 200 }}
            >
              <h4 className="p-2 m-0 text-center font-weight-bold">
                {col.display}
              </h4>
              <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
                {expIds.map((e) => {
                  const exp = experimentMap.get(e);
                  if (!exp) return null;
                  return (
                    <div key={e} className="card m-3">
                      <div className="card-body">
                        <Link href={`/experiment/${exp.id}`}>
                          <a className="h5">{exp.name}</a>
                        </Link>
                        {exp.description && (
                          <div
                            className="mt-2"
                            style={{ maxHeight: 100, overflow: "hidden" }}
                          >
                            <Markdown>{exp.description}</Markdown>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
