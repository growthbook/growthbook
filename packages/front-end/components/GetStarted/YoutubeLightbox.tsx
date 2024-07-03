import { MdClose } from "react-icons/md";
import Portal from "@/components/Modal/Portal";

export type Props = {
  close: () => void;
  videoId: string;
};

export default function YouTubeLightBox({ close, videoId }: Props) {
  return (
    <Portal>
      <div
        className="d-flex justify-content-center align-items-center position-fixed"
        style={{
          left: 0,
          right: 0,
          bottom: 0,
          top: 0,
        }}
      >
        <div
          className="modal-backdrop show fade"
          onClick={(e) => {
            e.preventDefault();
            close();
          }}
        />

        <div
          className="bg-white rounded position-relative p-5"
          style={{ zIndex: 1050, maxWidth: "100%" }}
        >
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              close();
            }}
            className="text-muted position-absolute"
            style={{
              top: 5,
              right: 13,
              fontSize: "1.8em",
            }}
          >
            <MdClose />
          </a>
          <div
            className="video position-relative"
            style={{
              paddingBottom: "56.25%" /* 16:9 */,
              paddingTop: 25,
              height: 0,
              width: 1000,
              maxWidth: "100%",
            }}
          >
            <iframe
              className="position-absolute w-100 h-100"
              style={{
                top: 0,
                left: 0,
              }}
              src={`https://www.youtube.com/embed/${videoId}`}
              frameBorder="0"
            />
          </div>
        </div>
      </div>
    </Portal>
  );
}
