import { Variation } from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import Carousel from "../Carousel";
import ScreenshotUpload from "../EditExperiment/ScreenshotUpload";
import VisualCode from "./VisualCode";

export interface Props {
  v: Variation;
  i: number;
  experimentId: string;
  mutate: () => void;
  canEdit: boolean;
  isVisual?: boolean;
  className?: string;
}

export default function VariationBox({
  v,
  i,
  canEdit,
  experimentId,
  isVisual = false,
  mutate,
  className,
}: Props) {
  const { apiCall } = useAuth();

  return (
    <div
      className={`${
        className || ""
      } border rounded text-center position-relative d-flex flex-column bg-white`}
      style={{ maxWidth: 600 }}
    >
      <div className="p-3">
        <div>
          <strong>{v.name}</strong>{" "}
        </div>
        <div className="mb-1">
          <small className="text-muted">id: {v.key || i}</small>
        </div>
        {v.description && <p>{v.description}</p>}
        {isVisual && (
          <VisualCode
            dom={v.dom || []}
            css={v.css || ""}
            experimentId={experimentId}
            control={i === 0}
          />
        )}
      </div>
      {v.screenshots.length > 0 ? (
        <Carousel
          deleteImage={
            !canEdit
              ? null
              : async (j) => {
                  const { status, message } = await apiCall<{
                    status: number;
                    message?: string;
                  }>(`/experiment/${experimentId}/variation/${i}/screenshot`, {
                    method: "DELETE",
                    body: JSON.stringify({
                      url: v.screenshots[j].path,
                    }),
                  });

                  if (status >= 400) {
                    throw new Error(
                      message || "There was an error deleting the image"
                    );
                  }

                  mutate();
                }
          }
        >
          {v.screenshots.map((s) => (
            <img className="experiment-image" key={s.path} src={s.path} />
          ))}
        </Carousel>
      ) : (
        <div className="image-blank" />
      )}
      <div style={{ flex: 1 }} />
      {canEdit && (
        <div className="p-3">
          <ScreenshotUpload
            experiment={experimentId}
            variation={i}
            onSuccess={() => mutate()}
          />
        </div>
      )}
    </div>
  );
}
