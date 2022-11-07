import { ReactNode, useState } from "react";
import Tooltip from "../Tooltip/Tooltip";

type Props = {
  valueToCopy?: string;
  children: ReactNode;
};

export default function ClickToCopy({ valueToCopy, children }: Props) {
  const [copyText, setCopyText] = useState("Copy");
  return (
    <Tooltip
      className={valueToCopy && "w-100"}
      role="button"
      tipMinWidth="45px"
      tipPosition="top"
      body={!valueToCopy ? "Click the eye to reveal" : copyText}
      style={{ paddingLeft: "5px" }}
      onClick={(e) => {
        e.preventDefault();
        if (valueToCopy) {
          navigator.clipboard
            .writeText(valueToCopy)
            .then(() => {
              setCopyText("Copied!");
            })
            .then(() => {
              setTimeout(() => {
                setCopyText("Copy");
              }, 2000);
            })
            .catch((e) => {
              console.error(e);
            });
        }
      }}
    >
      {children}
    </Tooltip>
  );
}
