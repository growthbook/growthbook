import { FC, useEffect, useState } from "react";

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
      className="alert alert-success shadow sticky-top text-center"
      style={{
        top: 55,
        transition: "200ms all",
        opacity: closing ? 0 : 1,
      }}
    >
      {children}
    </div>
  );
};

export default TempMessage;
