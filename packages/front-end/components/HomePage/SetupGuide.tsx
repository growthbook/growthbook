import Link from "next/link";
import React, { useState } from "react";
import { FaChevronDown, FaChevronRight } from "react-icons/fa";
import { HelpLink, Task } from "../../pages/getstarted";
import GetStartedCard from "./GetStartedCard";
import ToDoItem from "./ToDoItem";

type Props = {
  title: string;
  tasks?: Task[];
  helpLinks?: HelpLink[];
  percentComplete?: number;
  open: boolean;
  dismissedSteps?: {
    [key: string]: boolean;
  };
  showSubHead?: boolean;
  setDismissedSteps?: (value: { [key: string]: boolean }) => void;
};

export default function SetupGuide({
  title,
  tasks,
  helpLinks,
  percentComplete,
  open,
  dismissedSteps,
  setDismissedSteps,
  showSubHead,
}: Props) {
  const [isOpen, setIsOpen] = useState(open);
  const [selectedTask, setSelectedTask] = useState(tasks ? tasks[0] : null);

  return (
    <div
      className="container"
      style={{
        backgroundColor: "white",
        padding: "50px",
        margin: "10px",
        border: "1px solid rgba(0, 0, 0, 0.125)",
        borderRadius: "0.25rem",
        width: "auto",
      }}
    >
      <div className="row" role="button" onClick={() => setIsOpen(!isOpen)}>
        <div className="col-9">
          <h3 className="mb-0">{title}</h3>
        </div>
        <div
          className="col-2"
          style={{
            textAlign: "right",
          }}
        >
          {(percentComplete || percentComplete === 0) && (
            <span style={{ color: "#26A66B", fontWeight: "bold" }}>
              {`${percentComplete}% Complete`}
            </span>
          )}
        </div>
        <div
          className="col-1"
          style={{
            textAlign: "right",
          }}
        >
          {isOpen ? <FaChevronDown /> : <FaChevronRight />}
        </div>
      </div>
      {isOpen && tasks && (
        <>
          <div
            className="row"
            style={{ marginTop: "10px", marginBottom: "10px" }}
          >
            {showSubHead && (
              <div className="col">
                <p className="mb-0">
                  Follow the steps below to start using GrowthBook.
                  <span> </span>
                  <span>
                    <Link href="/settings/team">
                      Not a technical person? Invite an engineer.
                    </Link>
                  </span>
                </p>
              </div>
            )}
          </div>
          <div
            className="row m-0 pt-4 pb-0"
            style={{
              width: "100%",
              flexDirection: "row",
            }}
          >
            <div className="col-4">
              {tasks.map((task) => {
                return (
                  <ToDoItem
                    key={task.title}
                    task={task}
                    setValue={setSelectedTask}
                    selected={selectedTask.title === task.title}
                    completed={task.completed}
                  />
                );
              })}
            </div>
            <div className="col p-0">
              <GetStartedCard
                task={selectedTask}
                dismissedSteps={dismissedSteps}
                setDismissedSteps={setDismissedSteps}
              />
            </div>
          </div>
        </>
      )}
      {isOpen && helpLinks && (
        <>
          <div
            className="row p-1 d-flex justify-content-space-between"
            style={{
              marginTop: "10px",
              marginBottom: "10px",
              width: "100%",
              justifyContent: "space-between",
            }}
          >
            {helpLinks.map((link) => {
              return (
                <a
                  key={link.title}
                  className="btn btn btn-outline-dark text-left p-3 m-1"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ width: "32%" }}
                >
                  <h4>{link.title}</h4>
                  <p className="m-0">{link.helpText}</p>
                </a>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
