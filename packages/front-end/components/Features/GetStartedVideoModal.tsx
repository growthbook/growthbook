import { useEffect } from "react";
import usePermissions from "../../hooks/usePermissions";
import useUser from "../../hooks/useUser";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import ReactPlayer from "react-player";

export default function GetStartedVideoModal({ close }: { close: () => void }) {
  const { settings, update } = useUser();
  const { apiCall } = useAuth();
  const permissions = usePermissions();

  // Record the fact that the video instructions have been seen
  useEffect(() => {
    if (!settings) return;
    if (settings.videoInstructionsViewed) return;
    if (!permissions.organizationSettings) return;
    (async () => {
      await apiCall(`/organization`, {
        method: "PUT",
        body: JSON.stringify({
          settings: {
            videoInstructionsViewed: true,
          },
        }),
      });
      await update();
    })();
  }, [settings]);

  return (
    <Modal
      close={close}
      open={true}
      size="lg"
      header="Growthbook 101"
      closeCta="Close"
    >
      <div className="d-flex justify-content-center">
        <ReactPlayer
          url="https://www.youtube.com/watch?v=1ASe3K46BEw"
          controls={true}
        />
      </div>
    </Modal>
  );
}
