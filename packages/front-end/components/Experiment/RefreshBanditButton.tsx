import React, { FC, useEffect, useMemo, useState } from "react";
import { BsArrowRepeat } from "react-icons/bs";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { FaCaretDown, FaExclamationCircle } from "react-icons/fa";
import { FaRegCircleCheck, FaRegCircleXmark } from "react-icons/fa6";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { trackSnapshot } from "@/services/track";
import Button from "@/components/Button";
import Dropdown from "@/components/Dropdown/Dropdown";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";

const RefreshBanditButton: FC<{
  mutate: () => void;
  experiment: ExperimentInterfaceStringDates;
  setError: (e: string | undefined) => void;
  setGeneratedSnapshot: (s: ExperimentSnapshotInterface | undefined) => void;
}> = ({
  mutate,
  experiment,
  setError: setOuterError,
  setGeneratedSnapshot: setOuterGeneratedSnapshot,
}) => {
  const [loading, setLoading] = useState(false);
  const [_error, setError] = useState("");
  const [generatedSnapshot, setGeneratedSnapshot] = useState<
    ExperimentSnapshotInterface | undefined
  >(undefined);
  const [longResult, setLongResult] = useState(false);
  const [reweight, setReweight] = useState(false);
  const [open, setOpen] = useState(false);

  const { setSnapshotType, mutateSnapshot } = useSnapshot();

  const { getDatasourceById } = useDefinitions();

  const error = useMemo(() => {
    const trimErrorMessage = (message) => {
      const index = message.indexOf("\n\nTraceback");
      return index === -1 ? message : message.substring(0, index);
    };
    return trimErrorMessage(_error);
  }, [_error]);
  useEffect(() => {
    if (error) {
      setOuterError(error);
    }
  }, [error, setOuterError]);

  const { apiCall } = useAuth();

  const refresh = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let res: any = null;
    try {
      res = await apiCall<{
        status: number;
        message: string;
        snapshot: ExperimentSnapshotInterface;
      }>(
        `/experiment/${experiment.id}/banditSnapshot`,
        {
          method: "POST",
          body: JSON.stringify({
            reweight,
          }),
        },
        (responseData) => {
          res = responseData;
        },
      );
      trackSnapshot(
        "create",
        "RefreshBanditButton",
        getDatasourceById(experiment.datasource)?.type || null,
        res.snapshot,
      );
      await mutate();
    } catch (e) {
      console.error(e);
    }
    return res;
  };

  return (
    <>
      <div className="d-flex align-items-center justify-content-end mx-2">
        <div className="text-muted d-block mr-2" style={{ fontSize: "12px" }}>
          Manually update and
        </div>
        <div className="btn-group position-relative">
          <Button
            color="outline-primary btn-sm"
            style={{ width: 130 }}
            loadingClassName="btn-outline-primary btn-sm disabled"
            setErrorText={setError}
            onClick={async () => {
              setLoading(true);
              setLongResult(false);

              const timer = setTimeout(() => {
                setLongResult(true);
              }, 5000);

              try {
                const res = await refresh();
                setGeneratedSnapshot(
                  res?.snapshot as ExperimentSnapshotInterface | undefined,
                );
                setOuterGeneratedSnapshot(
                  res?.snapshot as ExperimentSnapshotInterface | undefined,
                );
                const banditError = res?.snapshot?.banditResult?.error;
                if (res.status >= 400) {
                  setError(res.message || "Unable to update bandit.");
                } else if (banditError) {
                  setError(banditError);
                } else {
                  setError("");
                }
                setLoading(false);
                clearTimeout(timer);
              } catch (e) {
                setGeneratedSnapshot(undefined);
                setOuterGeneratedSnapshot(undefined);
                setLoading(false);
                clearTimeout(timer);
                throw e;
              }
              setSnapshotType("standard");
              mutateSnapshot();
            }}
          >
            <BsArrowRepeat /> {reweight ? "Update Weights" : "Check Results"}
          </Button>
          <Dropdown
            uuid="bandit-refresh-type"
            open={open}
            setOpen={setOpen}
            caret={false}
            toggle={
              <span className="px-2" style={{ lineHeight: "26px" }}>
                <FaCaretDown />
              </span>
            }
            toggleClassName="btn btn-outline-primary btn-sm p-0"
            toggleStyle={{ zIndex: "auto" }}
            className="nowrap py-0"
          >
            <button
              className="dropdown-item py-2"
              onClick={() => {
                setReweight(false);
                setOpen(false);
              }}
            >
              Check results
            </button>
            <button
              className="dropdown-item py-2"
              onClick={() => {
                setReweight(true);
                setOpen(false);
              }}
            >
              Check results and
              <br />
              update variation weights
              {experiment.banditStage === "explore" && (
                <div className="small text-warning-orange">
                  <FaExclamationCircle className="mr-1" />
                  Will immediately begin the <strong>Exploit</strong> stage
                </div>
              )}
            </button>
          </Dropdown>
        </div>
      </div>

      {loading && longResult ? (
        <div className="text-muted text-right mx-2 mt-1 small">
          This may take several minutes...
        </div>
      ) : null}
      {error ? (
        <div className="text-danger mx-2 my-2">
          <FaRegCircleXmark className="mr-1" />
          Update errored
        </div>
      ) : generatedSnapshot ? (
        <div className="text-success mx-2 my-2">
          <FaRegCircleCheck className="mr-1" />
          Update successful
        </div>
      ) : null}
    </>
  );
};

export default RefreshBanditButton;
