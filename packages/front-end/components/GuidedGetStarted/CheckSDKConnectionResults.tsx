import { SDKConnectionInterface } from "@/../back-end/types/sdk-connection";
import clsx from "clsx";
import { useState } from "react";
import { FaCheck, FaRetweet } from "react-icons/fa";
import LoadingSpinner from "../LoadingSpinner";
import styles from "./CheckSDKConnectionResults.module.scss";

type Props = {
  connection: SDKConnectionInterface;
  mutate: () => void;
  close: () => void;
};

export default function TestConnectionResults({
  connection,
  mutate,
  close,
}: Props) {
  const [fetchingConnectionStatus, setFetchingConnectionStatus] = useState(
    false
  );
  if (!connection)
    return (
      <p className="alert alert-danger">
        To test your connection, you&apos;ll first need to create an SDK
        Connection.
      </p>
    );

  return (
    <div className="d-flex flex-column align-content-center text-center p-3">
      {connection.connected ? (
        <>
          <div className="p-3">
            <FaCheck
              className={clsx(
                "align-self-center mb-4 p-3",
                styles.connectedBubble
              )}
            />
          </div>
          <h2 className={styles.connected}>Connected</h2>
          <p>
            Great job! You&apos;ve successfully connected your application to
            GrowthBook.
          </p>
        </>
      ) : (
        <>
          <div className="p-3">
            {fetchingConnectionStatus ? (
              <LoadingSpinner />
            ) : (
              <button
                className="btn btn-outline-primary align-self-center m-2"
                onClick={() => {
                  setFetchingConnectionStatus(true);
                  mutate();
                  setTimeout(() => {
                    setFetchingConnectionStatus(false);
                  }, 1000);
                }}
              >
                <FaRetweet className="mr-2" />
                Check Again
              </button>
            )}
          </div>
          <h2 className={styles.notConnected}>Status: Not Connected</h2>
          <p>
            Something isn&apos;t quite right. Please double check that
            you&apos;ve created a feature flag and implemented the SDK
            instructions correctly.{" "}
            <a href="#" onClick={close} className="pl-1">
              View Implementation Instructions.
            </a>
          </p>
        </>
      )}
    </div>
  );
}
