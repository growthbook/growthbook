import { ReactNode, FC, useEffect, useState, CSSProperties } from "react";
import clsx from "clsx";

const SHOW_TIME = 3000;

type TempMessageProps = {
  close: () => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
};
const TempMessage: FC<TempMessageProps> = ({
  children,
  close,
  className = "",
  style = {},
}) => {
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
      className={clsx(
        "alert alert-success shadow sticky-top text-center",
        className
      )}
      style={{
        top: 55,
        transition: "200ms all",
        opacity: closing ? 0 : 1,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export default TempMessage;
