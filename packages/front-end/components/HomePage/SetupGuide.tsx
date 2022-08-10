import Link from "next/link";
import React, { useState } from "react";
import { FaChevronDown, FaChevronRight } from "react-icons/fa";
import { Task } from "../../pages/getstarted";
import GetStartedCard from "./GetStartedCard";
import ToDoItem from "./ToDoItem";

type Props = {
  title: string;
  tasks: Task[];
  percentComplete: number;
};

export default function SetupGuide({ title, tasks, percentComplete }: Props) {
  console.log("percentComplete", percentComplete);
  const [isOpen, setIsOpen] = useState(percentComplete !== 100 ? true : false);
  const [selectedTask, setSelectedTask] = useState(tasks[0]);

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
          <span style={{ color: "#26A66B", fontWeight: "bold" }}>
            {`${percentComplete}% Complete`}
          </span>
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
      {isOpen && (
        <>
          <div
            className="row"
            style={{ marginTop: "10px", marginBottom: "10px" }}
          >
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
              <GetStartedCard task={selectedTask} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
