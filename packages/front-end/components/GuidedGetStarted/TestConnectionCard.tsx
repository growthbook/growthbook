import clsx from "clsx";
import { FaCheck } from "react-icons/fa";
import { useState } from "react";
import { SDKConnectionInterface } from "@/../back-end/types/sdk-connection";
import LoadingSpinner from "../LoadingSpinner";
import Field from "../Forms/Field";
import styles from "./TestConnectionCard.module.scss";

type Props = {
  connections: SDKConnectionInterface[];
  handleNextStep: () => void;
  handlePreviousStep: () => void;
};

export default function TestConnectionCard({
  connections,
  handleNextStep,
  handlePreviousStep,
}: Props) {
  const [selectedSDK, setSelectedSDK] = useState(() => {
    if (connections && connections[0]) {
      return connections[0];
    } else {
      return null;
    }
  });

  // This is probably an edge case, but in the event an org has more than 1 sdk connection,
  // this allows the user to choose which SDK Connection to test.
  if (!connections?.length)
    return (
      <p className="alert alert-danger">
        To test your connection, you&apos;ll first need to
        <a href="#" onClick={async () => handlePreviousStep()} className="pl-1">
          create an SDK Connection.
        </a>
      </p>
    );
  return (
    <>
      {connections?.length > 1 && (
        <div className="d-flex justify-content-end">
          <Field
            label="Select SDK Connection"
            options={connections.map((connection) => connection.name)}
            onChange={(e) => {
              const index = connections.findIndex(
                (connection) => connection.name === e.target.value
              );
              setSelectedSDK(connections[index]);
            }}
          />
        </div>
      )}
      <div className={clsx("col-12 col-lg-10 p-4", styles.wrapper)}>
        <div className="d-flex flex-column align-content-center text-center">
          {selectedSDK?.connected ? (
            <FaCheck
              className={clsx(
                "align-self-center mb-4 p-3",
                styles.connectedBubble
              )}
            />
          ) : (
            <div className="pb-3">
              <LoadingSpinner />
            </div>
          )}
          <h1>
            Status:
            <span
              className={clsx(
                "pl-1",
                selectedSDK?.connected ? styles.connected : styles.notConnected
              )}
            >
              {selectedSDK?.connected ? "Connected" : "Not Connected"}
            </span>
          </h1>
          <p>
            {selectedSDK?.connected
              ? "Great job! You've successfully connected your application to GrowthBook."
              : "Something isn't quite right. Please double check that you've created a feature flag and implemented the SDK instructions correctly."}
            {!selectedSDK?.connected && (
              <a
                href="#"
                onClick={async () => handlePreviousStep()}
                className="pl-1"
              >
                View Implementation Instructions.
              </a>
            )}
          </p>
        </div>
        <div className="d-flex flex-column justify-content-center align-content-center">
          <button
            className="btn btn-primary align-self-center m-2"
            onClick={handleNextStep}
          >
            Next Step: Add Data Source
          </button>
        </div>
      </div>
    </>
  );
}
