import Link from "next/link";
import React, { useState } from "react";
import { HelpLink, Task } from "../../pages/getstarted";
import SetupGuideCard from "./GetStartedCard";
import ToDoItem from "./ToDoItem";

type Props = {
  tasks?: Task[];
  helpLinks?: HelpLink[];
  percentComplete?: number;
  dismissedSteps?: {
    [key: string]: boolean;
  };
  showSubHead?: boolean;
  setDismissedSteps: (value: { [key: string]: boolean }) => void;
};

export default function SetupGuide({
  tasks,
  dismissedSteps,
  setDismissedSteps,
  showSubHead,
}: Props) {
  const [selectedTask, setSelectedTask] = useState(tasks ? tasks[0] : null);

  return (
    <>
      <div className="row" style={{ marginTop: "10px", marginBottom: "10px" }}>
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
          <SetupGuideCard
            task={selectedTask}
            dismissedSteps={dismissedSteps}
            setDismissedSteps={setDismissedSteps}
          />
        </div>
      </div>
    </>
  );
}
