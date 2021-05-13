import { FC } from "react";
import { LearningInterface } from "back-end/types/insight";
import useForm from "../../hooks/useForm";
import Modal from "../Modal";
import { useAuth } from "../../services/auth";
import TagsInput from "../TagsInput";
import { FaPlus } from "react-icons/fa";
import useApi from "../../hooks/useApi";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useDefinitions } from "../../services/DefinitionsContext";

const InsightForm: FC<{
  insight: Partial<LearningInterface>;
  mutate: () => void;
  close: () => void;
}> = ({ insight, close, mutate }) => {
  const { data } = useApi<{ experiments: ExperimentInterfaceStringDates[] }>(
    `/experiments`
  );

  const [value, inputProps, manualUpdate] = useForm(
    {
      text: insight.text || "",
      details: insight.details || "",
      tags: insight.tags || [],
      evidence: insight.evidence || [],
    },
    insight.id || "new",
    {
      className: "form-control",
    }
  );

  const edit = !!insight.id;

  const { apiCall } = useAuth();
  const { refreshTags } = useDefinitions();

  const submit = async () => {
    const body = {
      ...value,
    };

    await apiCall<{ status: number; message?: string }>(
      edit ? `/learning/${insight.id}` : `/learnings`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
    mutate();
    refreshTags(value.tags);
  };

  return (
    <Modal
      header={edit ? "Edit Insight" : "New Insight"}
      close={close}
      open={true}
      submit={submit}
      cta={edit ? "Save" : "Create"}
      closeCta="Cancel"
    >
      <div className={`form-group`}>
        <label>Short Description</label>
        <input type="text" required {...inputProps.text} />
        <small className="form-text text-muted">
          You&apos;ll be able to add more details later
        </small>
      </div>
      <div className="form-group">
        <label>Tags</label>
        <TagsInput
          value={value.tags}
          onChange={(tags) => {
            manualUpdate({ tags });
          }}
        />
      </div>
      {data?.experiments && (
        <div>
          <label>Experimental Evidence</label>
          {value.evidence.map((e: { experimentId: string }, i: number) => (
            <div className="input-group mb-2" key={i}>
              <select
                {...inputProps.evidence[i].experimentId}
                className="custom-select"
              >
                <option value=""></option>
                {data?.experiments ? (
                  data.experiments.map((exp) => (
                    <option value={exp.id} key={exp.id}>
                      {exp.name}
                    </option>
                  ))
                ) : (
                  <option value={e.experimentId}>{e.experimentId}</option>
                )}
              </select>
              <div className="input-group-append">
                <button
                  className="btn btn-outline-danger"
                  onClick={(e) => {
                    e.preventDefault();
                    const newEvidence = [...value.evidence];
                    newEvidence.splice(i, 1);
                    manualUpdate({
                      evidence: newEvidence,
                    });
                  }}
                >
                  &times;
                </button>
              </div>
            </div>
          ))}
          <div>
            <button
              className="btn btn-outline-success"
              onClick={(e) => {
                e.preventDefault();
                manualUpdate({
                  evidence: [...value.evidence, { experimentId: "" }],
                });
              }}
            >
              <FaPlus /> Add Evidence
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default InsightForm;
