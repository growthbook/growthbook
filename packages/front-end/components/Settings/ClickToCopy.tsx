import clsx from "clsx";
import { ReactNode, useState } from "react";
import Tooltip from "../Tooltip/Tooltip";
import styles from "./ClickToRevealKey.module.scss";

type Props = {
  valueToCopy?: string;
  children?: ReactNode;
};

export default function ClickToCopy({ valueToCopy, children }: Props) {
  const [copyText, setCopyText] = useState("Copy");
  return (
    <Tooltip
      className={clsx(!valueToCopy && styles.hideText)}
      role="button"
      tipMinWidth="45px"
      tipPosition="top"
      body={!valueToCopy ? "Click the eye to reveal" : copyText}
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
