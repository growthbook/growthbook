import { ReactNode, FC, useEffect, useState, CSSProperties } from "react";
import clsx from "clsx";

const SHOW_TIME = 3000;

type TempMessageProps = {
  close: () => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  delay?: number | null;
  top?: number;
  showClose?: boolean;
};
const TempMessage: FC<TempMessageProps> = ({
  close,
  children,
  className = "",
  style = {},
  delay = SHOW_TIME,
  top = 55,
  showClose = false,
}) => {
  const [closing, setClosing] = useState(false);

  // Start closing after delay ms, or keep open for null
  useEffect(() => {
    if (delay !== null) {
      const timer = setTimeout(() => {
        setClosing(true);
      }, delay);
      return () => {
        clearTimeout(timer);
      };
    }
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
        className,
      )}
      style={{
        top,
        transition: "200ms all",
        opacity: closing ? 0 : 1,
        ...style,
      }}
    >
      {showClose && (
        <button
          className="close"
          style={{ right: -10, top: -5 }}
          onClick={(e) => {
            e.preventDefault();
            if (closing) return;
            setClosing(true);
          }}
        >
          <span aria-hidden="true">&times;</span>
        </button>
      )}
      {children}
    </div>
  );
};

export default TempMessage;
