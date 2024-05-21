import clsx from "clsx";
import { PiArrowSquareOut, PiPlayFill } from "react-icons/pi";
import styles from "@/components/GetStarted/GetStarted.module.scss";

interface Props {
  handleClick?: () => void;
  playTime?: number;
  imgUrl: string;
}

const FeaturedCard = ({ handleClick, playTime, imgUrl }: Props) => {
  return (
    <button
      className={clsx(styles.featuredCard, "border-0 rounded mr-3")}
      style={{
        width: "268px",
        height: "151px",
        background: `url("${imgUrl}")`,
        backgroundSize: "cover",
        position: "relative",
      }}
      onClick={handleClick && (() => handleClick())}
    >
      {playTime && (
        <div className={clsx(styles.playTime, "badge badge-pill badge-dark")}>
          <PiPlayFill /> {playTime} min
        </div>
      )}

      <div className={styles.featuredCardOverlay}>
        <span className="badge badge-pill badge-light px-3 py-2">
          {playTime ? (
            "Launch Video Player"
          ) : (
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <span>
                View Blog Post{" "}
                <PiArrowSquareOut
                  className="ml-1"
                  style={{
                    height: "15px",
                    width: "15px",
                    verticalAlign: "bottom",
                  }}
                />
              </span>
            </div>
          )}
        </span>
      </div>
    </button>
  );
};

export default FeaturedCard;
