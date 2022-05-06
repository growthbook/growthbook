import { FC, useEffect, useState, ReactElement } from "react";
import styles from "./TempMessage.module.scss";

type ModalProps = {
  message?: string | ReactElement;
  show: boolean;
  className?: string;
  showTime?: number;
  close?: () => void;
};
const Modal: FC<ModalProps> = ({
  message = "",
  children,
  show = false,
  className = "",
  showTime = 3000, // 3 seconds
  close,
}) => {
  const [showTimer, setShowTimer] = useState(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (show && !showTimer) {
      setShowTimer(
        setTimeout(() => {
          setClosing(true);
          setTimeout(() => {
            console.log("DONE setting showing to false");
            setClosing(false);
            setShowTimer(null);
            if (close) {
              close();
            }
          }, 500);
        }, showTime)
      );
    }
  }, [show]);

  return show ? (
    <div
      className={`temp-bar alert-success sticky-top ${className} ${
        styles.tempBar
      } ${closing ? styles.closing : ""}`}
    >
      <span>{message}</span>
      {children}
    </div>
  ) : (
    <></>
  );
};

export default Modal;
