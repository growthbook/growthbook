import clsx from "clsx";
import { ReactNode, useState } from "react";
import Tooltip from "../Tooltip/Tooltip";
import styles from "./ClickToCopy.module.scss";

type Props = {
  valueToCopy?: string;
  children?: ReactNode;
};

export default function ClickToCopy({ valueToCopy, children }: Props) {
  const [copyText, setCopyText] = useState("Copy");
  return (
    <Tooltip
      className={clsx(!valueToCopy && styles.blurText, styles.tooltip)}
      role={valueToCopy && "button"}
      tipMinWidth="45px"
      tipPosition="top"
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
              }, 5000);
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
