import { useRouter } from "next/router";
import { FaExclamationTriangle } from "react-icons/fa";

export interface Props {
  experimentId: string;
  setDesiredSnapshot: (snapshotId: string | null) => void;
  missing: boolean;
}

export default function StaleSnapshotBanner({
  experimentId,
  setDesiredSnapshot,
  missing,
}: Props) {
  const router = useRouter();

  return (
    <div>
      <div className="d-flex align-items-center p-3 alert alert-danger">
        <div>
          {missing ? (
            <h3>
              <FaExclamationTriangle />{" "}
              {`The snapshot you selected does not exist.`}
            </h3>
          ) : (
            <>
              <h3>
                <FaExclamationTriangle />{" "}
                {`You are viewing a historical snapshot of this experiment.`}
              </h3>
              {
                "Metrics added since this snapshot was run will not show up below and many settings are frozen."
              }
            </>
          )}
          <div>
            <a
              role="button"
              className="btn-link"
              onClick={(e) => {
                e.preventDefault();
                setDesiredSnapshot(null);
                router.replace(`/experiment/${experimentId}`);
              }}
            >
              Return to latest snapshot.
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
