//import Link from "next/link";
import styles from "./NewPresentation.module.scss";
import { useState } from "react";
import clsx from "clsx";
import PresentationInfo from "./PresentationInfo";
import Finished from "./Finished";
import { useAuth } from "../../services/auth";
import { PresentationInterface } from "back-end/types/presentation";

const NewLearning = ({
  modalState,
  setModalState,
  refreshList,
}: {
  modalState: boolean;
  setModalState: (state: boolean) => void;
  refreshList: () => void;
}): React.ReactElement => {
  // handlers for the step forms:
  const [presentationData, setPresentationData] = useState<
    Partial<PresentationInterface>
  >({
    title: "A/B Tests Review",
    description: "",
    experimentIds: [],
    options: {},
  });

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // since this is a multi step form, need to keep track of which step we're on
  const [step, setStep] = useState<"form" | "done">("form");

  const { apiCall } = useAuth();
  const submitForm = async (e) => {
    e.preventDefault();
    // @todo some validation needed

    if (loading) return;
    setLoading(true);
    setError(null);

    const l = { ...presentationData };
    console.log("senging ", l);
    try {
      const res = await apiCall<{ status: number; message?: string }>(
        "/presentation",
        {
          method: "POST",
          body: JSON.stringify(l),
        }
      );
      if (res.status === 200) {
        onSuccess();
        refreshList();
        setLoading(false);
      } else {
        console.error(res);
        setError(
          res.message ||
            "There was an error submitting the form. Please try again."
        );
        setLoading(false);
      }
    } catch (e) {
      console.error(e);
      setError(e.message);
      setLoading(false);
    }
  };

  const onSuccess = () => {
    //setpresentationData(res.learning);
    setStep("done");
  };

  const loadNextButton = () => {
    if (step === "done") {
      return (
        <button onClick={closeModal} className="btn btn-primary">
          Done
        </button>
      );
    } else {
      // submit button:
      return (
        <button onClick={submitForm} className="btn btn-primary">
          Create
        </button>
      );
    }
  };

  const closeModal = () => {
    setModalState(false);
  };

  return (
    <>
      <div
        className={clsx(
          styles.modalbackground,
          "modal-backdrop fade",
          { show: modalState },
          { [styles.modalhide]: !modalState }
        )}
        onClick={closeModal}
      ></div>
      <div
        className={clsx(
          styles.modalwrap,
          "modal fade bd-example-modal-lg new-presentations",
          { [styles.modalopen]: modalState },
          { show: modalState }
        )}
        id="exampleModal"
        role="dialog"
        aria-labelledby="exampleModalLabel"
        aria-hidden="true"
      >
        <div className="modal-dialog modal-lg" role="document">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Add New Presentation</h5>
              <button
                type="button"
                className="close"
                data-dismiss="modal"
                aria-label="Close"
                onClick={closeModal}
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div className="modal-body">
              <form className={styles.modalform}>
                <PresentationInfo
                  showForm={step === "form"}
                  handleChange={setPresentationData}
                  presentationData={presentationData}
                />
                <Finished showForm={step === "done"} />
              </form>
              {error && <div className="text-danger">{error}</div>}
            </div>
            <div className="modal-footer">{loadNextButton()}</div>
          </div>
        </div>
      </div>
    </>
  );
};
export default NewLearning;
