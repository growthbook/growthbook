import { FC, useState } from "react";
import { FaEye } from "react-icons/fa";
import { useAuth } from "../../services/auth";
import { useWatching } from "../../services/WatchProvider";

const WatchButton: FC<{
  experiment: string;
  type?: "button" | "icon" | "link";
}> = ({ experiment, type = "button" }) => {
  const { watching, refreshWatching } = useWatching();
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(false);

  const isWatching = watching.includes(experiment);

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
            `/experiment/${experiment}/${isWatching ? "unwatch" : "watch"}`,
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
