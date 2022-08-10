import React from "react";
import { Task } from "../../pages/getstarted";

type Props = {
  task: Task;
  setValue: (value: Task) => void;
  selected: boolean;
  completed: boolean;
};

export default function ToDoItem({ task, setValue, selected }: Props) {
  return (
    <div
      role="button"
      className="p-1"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        border: selected
          ? "4px solid #7548E1"
          : "4px solid transparent" || (task.completed && "#9AE79A"),
        borderRadius: "0.25rem",
      }}
      onClick={() => setValue(task)}
    >
      <div
        style={{
          height: "20px",
          width: "20px",
          borderRadius: "50%",
          border:
            (task.completed && "#9AE79A") ||
            (!selected && "2px solid darkgray"),
          backgroundColor:
            (task.completed && "#9AE79A") || (selected && "#7548E1"),
        }}
      ></div>
      <div
        className="pt-1 pb-1 pl-2"
        style={{ textDecoration: task.completed && "line-through" }}
      >
        {task.title}
      </div>
    </div>
  );
}
