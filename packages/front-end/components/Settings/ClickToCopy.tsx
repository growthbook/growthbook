import { ReactNode, useState } from "react";
import Tooltip from "../Tooltip/Tooltip";

type Props = {
  valueToCopy: string;
  children?: ReactNode;
};

export default function ClickToCopy({ valueToCopy, children }: Props) {
  const [copyText, setCopyText] = useState("Copy");
  return (
    <Tooltip
      role="button"
      tipMinWidth="45px"
      tipPosition="top"
      body={copyText}
      onClick={(e) => {
        e.preventDefault();
        navigator.clipboard
          .writeText(valueToCopy)
          .then(() => {
            setCopyText("Copied!");
          })
          .then(() => {
            setTimeout(() => {
              setCopyText("Copy");
            }, 5000);
          })
          .catch((e) => {
            console.error(e);
          });
      }}
    >
      {children}
    </Tooltip>
  );
}
