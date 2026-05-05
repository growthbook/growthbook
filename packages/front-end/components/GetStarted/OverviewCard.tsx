import { AspectRatio, Box, Text } from "@radix-ui/themes";
import { MouseEventHandler } from "react";
import { PiArrowSquareOut, PiPlayFill } from "react-icons/pi";
import styles from "./OverviewCard.module.scss";

export default function OverviewCard({
  onClick,
  href,
  playTime,
  imgUrl,
  type,
  hoverText,
}: {
  onClick?: MouseEventHandler<HTMLDivElement>;
  href?: string;
  playTime?: number;
  imgUrl: string;
  hoverText: string;
  type: "video" | "link";
}) {
  const card = (
    <div
      className={styles.card}
      onClick={onClick}
      style={{ backgroundImage: `url("${imgUrl}")` }}
    >
      {type === "video" && playTime && playTime > 0 && (
        <Text size="1" className={styles.playTime}>
          <PiPlayFill size={10} />{" "}
          <span style={{ verticalAlign: "text-top" }}>{playTime} min</span>
        </Text>
      )}

      <div className={styles.hoverBackground}>
        <Text size="1" weight="medium" className={styles.hoverText}>
          {hoverText} {type === "link" && <PiArrowSquareOut size={13} />}
        </Text>
      </div>
    </div>
  );

  return (
    <Box width="100%" height="100%">
      <AspectRatio ratio={16 / 9}>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {card}
          </a>
        ) : (
          card
        )}
      </AspectRatio>
    </Box>
  );
}
