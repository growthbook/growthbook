import { FC, useEffect, useState } from "react";
import styles from "./TempMessage.module.scss";

const SHOW_TIME = 3000;

type TempMessageProps = {
  close: () => void;
};
const TempMessage: FC<TempMessageProps> = ({ children, close }) => {
  const [closing, setClosing] = useState(false);

  // Start closing after SHOW_TIME ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setClosing(true);
    }, SHOW_TIME);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  // Close after waiting for fade out animation to finish
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => {
      setClosing(false);
      close();
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [closing]);

  return (
    <div
      className={`alert alert-success shadow sticky-top ${styles.tempBar} ${
        closing ? styles.closing : ""
      }`}
    >
      {children}
    </div>
  );
};

export default TempMessage;
