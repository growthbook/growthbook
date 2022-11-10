import { ReactNode, useState } from "react";
import Tooltip from "../Tooltip/Tooltip";

type Props = {
  valueToCopy?: string;
  children?: ReactNode;
};

export default function ClickToCopy({ valueToCopy, children }: Props) {
  const [copyText, setCopyText] = useState("Copy");
  return (
    <Tooltip
      role={valueToCopy && "button"}
      tipMinWidth="45px"
      tipPosition="top"
      style={{
        color: !valueToCopy && "transparent",
        textShadow: !valueToCopy && "0 0 5px #3b3b3b",
        overflowWrap: "anywhere",
      }}
      body={valueToCopy && copyText}
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
