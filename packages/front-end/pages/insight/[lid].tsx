import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../../components/LoadingOverlay";
import { useState, ReactElement, useContext } from "react";
import { useAuth } from "../../services/auth";
import Link from "next/link";
import DeleteButton from "../../components/DeleteButton";
import { FaAngleLeft, FaAngleRight } from "react-icons/fa";
import DiscussionThread from "../../components/DiscussionThread";
import useSwitchOrg from "../../services/useSwitchOrg";
import { date } from "../../services/dates";
import { UserContext } from "../../components/ProtectedPage";
import EditableH1 from "../../components/Forms/EditableH1";
import InlineForm from "../../components/Forms/InlineForm";
import TagsInput from "../../components/TagsInput";
import MarkdownEditor from "../../components/Forms/MarkdownEditor";
import { useTags } from "../../services/TagsContext";
import { LearningInterface } from "back-end/types/insight";

const InsightPage = (): ReactElement => {
  const router = useRouter();
  const { lid } = router.query;
  const [edit, setEdit] = useState(false);

  const { push } = useRouter();

  const { apiCall } = useAuth();
  const { refreshTags } = useTags();

  const { data, error: dataError, mutate } = useApi<{
    status: number;
    message: string;
    learning: LearningInterface;
    experiments: ExperimentInterfaceStringDates[];
  }>(`/learning/${lid}`);

  useSwitchOrg(data?.learning?.organization);
  const { getUserDisplay } = useContext(UserContext);

  if (dataError) {
    return (
      <div className="alert alert-danger">
        {dataError.message || "There was a problem loading this learning"}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const learning = data.learning;

  // put experiments in an easier to access form:
  const expMap = new Map<string, { id: string; name: string }>();
  data.experiments.map((v) => {
    if (v && v.id) {
      expMap.set(v.id, {
        id: v.id,
        name: v.name,
      });
    }
  });
  const evidence = learning.evidence
    .map((e) => {
      return expMap.get(e.experimentId);
    })
    .filter(Boolean);

  return (
    <div className="container-fluid pagecontents pt-4">
      <div className="mb-2 row d-flex">
        <div className="col">
          <Link href="/insights">
            <a>
              <FaAngleLeft /> All Insights
            </a>
          </Link>
        </div>
        <div className="col-md-auto">
          <DeleteButton
            displayName="Insight"
            link={true}
            onClick={async () => {
              await apiCall<{ status: number; message?: string }>(
                `/learning/${lid}`,
                {
                  method: "DELETE",
                  body: JSON.stringify({ id: lid }),
                }
              );

              push("/insights");
            }}
          />
        </div>
      </div>
      <div className=" row">
        <div className="col">
          <InlineForm
            setEdit={setEdit}
            editing={edit}
            className="mb-4 bg-white border idea-wrap"
            onSave={async (value, details) => {
              await apiCall<{ status: number; message?: string }>(
                `/learning/${lid}`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    ...value,
                    details,
                  }),
                }
              );
              await mutate({
                ...data,
                learning: {
                  ...data.learning,
                  ...value,
                  details,
                },
              });
              refreshTags();
              setEdit(false);
            }}
            initialValue={{
              text: learning.text,
              tags: learning.tags || [],
            }}
          >
            {({
              inputProps,
              value,
              manualUpdate,
              onMarkdownChange,
              save,
              cancel,
            }) => (
              <div className="p-3">
                <div className="row">
                  <div className="col">
                    <EditableH1 {...inputProps.text} editing={edit} />
                  </div>
                  {!edit && (
                    <div className="col-auto">
                      <button
                        className="btn btn-outline-secondary mr-3"
                        onClick={() => {
                          setEdit(true);
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
                {edit ? (
                  <div className="py-2 mb-2">
                    <TagsInput
                      value={value.tags}
                      onChange={(tags) =>
                        manualUpdate({
                          tags,
                        })
                      }
                    />
                  </div>
                ) : (
                  <div className="row text-muted mb-4">
                    <div className="col-auto">
                      <small>
                        Added by{" "}
                        <strong className="mr-1">
                          {getUserDisplay(learning.userId)}
                        </strong>
                        on <strong>{date(learning.dateCreated)}</strong>
                      </small>
                    </div>
                    <div className="col-auto">
                      <small>Tags: </small>
                      {learning.tags &&
                        Object.values(learning.tags).map((col) => (
                          <span
                            className="badge badge-secondary mr-2"
                            key={col}
                          >
                            {col}
                          </span>
                        ))}
                      {!learning.tags?.length && <em>None</em>}
                    </div>
                  </div>
                )}

                <MarkdownEditor
                  defaultValue={learning.details || ""}
                  editing={edit}
                  onChange={onMarkdownChange}
                  save={save}
                  cancel={cancel}
                />
              </div>
            )}
          </InlineForm>
        </div>
      </div>
      <div className="mb-3">
        <h3>Evidence</h3>
        {evidence?.length > 0 ? (
          <div className="list-group">
            {evidence.map((e) => (
              <Link href={`/experiment/${e.id}`} key={e.id}>
                <a className="list-group-item list-group-item-action d-flex align-items-center">
                  <div>
                    <strong className="text-muted">Experiment:</strong> {e.name}
                  </div>
                  <div style={{ flex: 1 }} />
                  <FaAngleRight />
                </a>
              </Link>
            ))}
          </div>
        ) : (
          <em>None</em>
        )}
      </div>
      <div className="mb-3">
        <h3>Comments</h3>
        <DiscussionThread type="insight" id={learning.id} />
      </div>
    </div>
  );
};

export default InsightPage;
