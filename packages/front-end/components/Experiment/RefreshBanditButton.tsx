import { FC, useState } from "react";
import { BsArrowRepeat } from "react-icons/bs";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { FaGear } from "react-icons/fa6";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { trackSnapshot } from "@/services/track";
import Button from "@/components/Button";
import Dropdown from "@/components/Dropdown/Dropdown";

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
      <div className="btn-group">
        <Button
          color="outline-primary"
          onClick={async () => {
            // resetFilters?.();
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
          toggle={
            <div className="d-inline-block py-2 pl-2">
              <FaGear />
            </div>
          }
          toggleClassName="btn btn-outline-primary p-0 pr-1"
          toggleStyle={{ zIndex: "auto" }}
          className="nowrap py-0"
          header={<div className="text-muted pt-1">Refreshing will...</div>}
        >
          <button
            className="dropdown-item py-2"
            onClick={() => {
              setReweight(true);
              setOpen(false);
            }}
          >
            Update variation weights
          </button>
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
