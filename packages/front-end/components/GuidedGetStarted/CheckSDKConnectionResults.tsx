import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import clsx from "clsx";
import { BsArrowRepeat } from "react-icons/bs";
import { FaCheck } from "react-icons/fa";
import Button from "../Button";
import styles from "./CheckSDKConnectionResults.module.scss";

type Props = {
  connection: SDKConnectionInterface;
  mutate: () => Promise<unknown>;
  close: () => void;
};

export default function TestConnectionResults({
  connection,
  mutate,
  close,
}: Props) {
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
            <Button
              color="outline-primary"
              className="align-self-center m-2"
              onClick={async () => {
                await mutate();
              }}
            >
              <BsArrowRepeat /> Check Again
            </Button>
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
