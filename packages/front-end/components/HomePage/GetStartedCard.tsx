import { Task } from "../../pages/getstarted";

type Props = {
  task: Task;
};

export default function GetStartedCard({ task }: Props) {
  return (
    <div
      className="p-4"
      style={{
        backgroundColor: "#F6F7FA",
        borderRadius: "0.25rem",
        border: "1px solid rgba(0, 0, 0, 0.125)",
      }}
    >
      <div>
        <h4>{task.title}</h4>
        <p>
          {task.text}{" "}
          {task.link && task.learnMoreLink && (
            <span>
              <a href={task.link} target="_blank" rel="noreferrer">
                {task.learnMoreLink}
              </a>
            </span>
          )}
        </p>
      </div>
      <div
        className="pt-4"
        style={{ display: "flex", justifyContent: "flex-end" }}
      >
        {/* {!task.completed && ( //TODO: The idea is to give users the ability to say "no thanks" to certain feature and that mark the feature as complete.
          <button type="button" className="btn btn-link">
            Mark as Complete
          </button>
        )} */}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            task.onClick(true);
          }}
        >
          {task.cta}
        </button>
      </div>
    </div>
  );
}
