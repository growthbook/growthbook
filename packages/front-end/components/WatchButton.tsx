import { FC, useState } from "react";
import { FaEye } from "react-icons/fa";
import { useAuth } from "@front-end/services/auth";
import { useWatching } from "@front-end/services/WatchProvider";

const WatchButton: FC<{
  item: string;
  itemType: "feature" | "experiment";
  type?: "button" | "icon" | "link";
  className?: string;
}> = ({ item, itemType, type = "button", className }) => {
  const {
    watchedExperiments,
    watchedFeatures,
    refreshWatching,
  } = useWatching();
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(false);

  let isWatching;
  if (itemType == "feature") {
    isWatching = watchedFeatures.includes(item);
  } else if (itemType == "experiment") {
    isWatching = watchedExperiments.includes(item);
  }

  let classNames =
    "watchaction watch-" + type + (isWatching ? " watching" : " notwatching");
  let text = "";
  if (type === "button") {
    classNames += " btn btn-link";
    text = isWatching ? "watching" : "watch";
  } else if (type === "link") {
    text = isWatching ? "watching" : "watch";
  }
  if (loading) {
    classNames += " disabled";
  }

  if (className) {
    classNames += " " + className;
  }

  return (
    <a
      className={classNames}
      href="#"
      title={isWatching ? "click to unwatch" : "click to watch"}
      onClick={async (e) => {
        e.preventDefault();
        if (loading) return;
        setLoading(true);
        try {
          await apiCall(
            `/user/${isWatching ? "unwatch" : "watch"}/${itemType}/${item}`,
            {
              method: "POST",
            }
          );
          refreshWatching();
        } catch (e) {
          console.error(e);
        }

        setLoading(false);
      }}
    >
      <FaEye /> <span>{text}</span>
    </a>
  );
};

export default WatchButton;
