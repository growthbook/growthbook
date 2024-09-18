import { FC, useState } from "react";
import { BsArrowRepeat } from "react-icons/bs";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { FaCaretDown } from "react-icons/fa";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { trackSnapshot } from "@/services/track";
import Button from "@/components/Button";
import Dropdown from "@/components/Dropdown/Dropdown";
import Tooltip from "@/components/Tooltip/Tooltip";

const RefreshBanditButton: FC<{
  mutate: () => void;
  experiment: ExperimentInterfaceStringDates;
}> = ({ mutate, experiment }) => {
  const [loading, setLoading] = useState(false);
  const [longResult, setLongResult] = useState(false);
  const [reweight, setReweight] = useState(false);
  const [open, setOpen] = useState(false);
  const { getDatasourceById } = useDefinitions();

  const { apiCall } = useAuth();

  const refresh = async () => {
    const res = await apiCall<{
      status: number;
      message: string;
      snapshot: ExperimentSnapshotInterface;
    }>(`/experiment/${experiment.id}/banditSnapshot`, {
      method: "POST",
      body: JSON.stringify({
        reweight,
      }),
    });
    trackSnapshot(
      "create",
      "RefreshBanditButton",
      getDatasourceById(experiment.datasource)?.type || null,
      res.snapshot
    );
    mutate();
  };

  return (
    <>
      {loading && longResult && (
        <small className="text-muted mr-3">this may take several minutes</small>
      )}
      <div className="btn-group position-relative">
        <Button
          color="outline-primary btn-sm"
          style={{ width: 130 }}
          loadingClassName="btn-outline-primary disabled"
          errorClassName="position-absolute small text-danger"
          errorStyle={{
            top: 36,
            left: 0,
            width: 200,
            whiteSpace: "normal",
            lineHeight: "14px",
          }}
          onClick={async () => {
            setLoading(true);
            setLongResult(false);

            const timer = setTimeout(() => {
              setLongResult(true);
            }, 5000);

            try {
              await refresh();
              setLoading(false);
              clearTimeout(timer);
            } catch (e) {
              setLoading(false);
              clearTimeout(timer);
              throw e;
            }
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
          header={<div className="text-muted pt-1">Refreshing will...</div>}
        >
          <Tooltip
            body={
              <>
                Will immediately begin the <strong>Exploit</strong> stage
              </>
            }
            popperStyle={{ marginRight: -25, marginTop: 5 }}
            shouldDisplay={experiment.banditPhase === "explore"}
            tipPosition="left"
          >
            <button
              className="dropdown-item py-2"
              onClick={() => {
                setReweight(true);
                setOpen(false);
              }}
            >
              <HiOutlineExclamationCircle className="mr-1 text-warning-orange" />
              Update variation weights
            </button>
          </Tooltip>
          <button
            className="dropdown-item py-2"
            onClick={() => {
              setReweight(false);
              setOpen(false);
            }}
          >
            Refresh results only
          </button>
        </Dropdown>
      </div>
    </>
  );
};

export default RefreshBanditButton;
