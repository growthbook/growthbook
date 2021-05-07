import { FC } from "react";
import styles from "./Tile.module.scss";
import Link from "next/link";
import clsx from "clsx";

const Tile: FC<{
  url: string;
  name: string;
  image: string;
  description: string;
  size?: "small" | "large";
}> = ({ url, name, image, description, size = "small" }) => {
  return (
    <Link href={url}>
      <a className={clsx(styles.tile, { [styles.large]: size === "large" })}>
        <img src={image} />
        <h4>{name}</h4>
        <p>{description}</p>
      </a>
    </Link>
  );
};

export default Tile;
