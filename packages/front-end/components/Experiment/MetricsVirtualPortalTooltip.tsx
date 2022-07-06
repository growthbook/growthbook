import { MetricInterface } from "back-end/types/metric";
import Link from "next/link";
import { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import MetricTooltipBody from "../Metrics/MetricTooltipBody";

interface Props {
  label: string;
  metric: MetricInterface;
}

export default function MetricsVirtualPortalTooltip({ label, metric }: Props) {
  const [show, setShow] = useState(false);
  const [domReady, setDomReady] = useState(false);
  const [popupRefElem, setPopupRefElem] = useState(null);
  const [popupTriggerRefElem, setPopupTriggerRefElem] = useState(null);

  const [top, setTop] = useState<number>();
  const [left, setLeft] = useState<number>();

  useEffect(() => {
    setDomReady(true);
  }, []);

  useEffect(() => {
    if (popupRefElem && popupTriggerRefElem && show) {
      const popupMeta = popupRefElem.getBoundingClientRect();
      const popupTriggerMeta = popupTriggerRefElem.getBoundingClientRect();
      const marginLeft = 16;

      setTop(
        parseFloat(popupTriggerMeta.top) -
          popupMeta.height / 2 +
          popupTriggerMeta.height / 2
      );
      setLeft(
        parseFloat(popupTriggerMeta.left) + popupTriggerMeta.width + marginLeft
      );
    }
  }, [popupRefElem, popupTriggerRefElem, show]);

  return (
    <>
      <Link href={`/metric/${metric.id}`}>
        <a
          ref={setPopupTriggerRefElem}
          onMouseEnter={() => setShow(true)}
          onMouseLeave={() => setShow(false)}
          className="text-dark font-weight-bold"
        >
          {label}
        </a>
      </Link>
      {domReady &&
        ReactDOM.createPortal(
          <div
            ref={setPopupRefElem}
            className="shadow-lg"
            style={{
              display: show ? "" : "none",
              position: "absolute",
              zIndex: 10000,
              background: "white",
              top: top,
              left: left,
              width: "240px",
              padding: "8px",
              borderRadius: "4px",
            }}
          >
            <MetricTooltipBody metric={metric} />
          </div>,
          document.querySelector("#__next")
        )}
    </>
  );
}
