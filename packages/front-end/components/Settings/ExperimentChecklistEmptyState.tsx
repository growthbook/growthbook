import { ChecklistTask } from "back-end/types/experimentLaunchChecklist";

export default function ExperimentChecklistEmptyState({
  setNewTaskInput,
}: {
  setNewTaskInput: (task: ChecklistTask) => void;
}) {
  return (
    <div className="alert alert-info d-flex flex-column align-items-center py-5">
      <p className="text-center">
        <strong>
          You haven&apos;t added any pre-launch checklist tasks. Click the
          button below to get started.
        </strong>
      </p>
      <div>
        <button
          className="btn btn-outline-primary"
          onClick={(e) => {
            e.preventDefault();
            setNewTaskInput({ task: "", completionType: "manual" });
          }}
        >
          Add Your First Task
        </button>
      </div>
    </div>
  );
}
