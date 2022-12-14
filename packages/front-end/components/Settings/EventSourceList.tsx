import { SchemaFormat } from "back-end/types/datasource";
import { useState } from "react";
import { MdKeyboardArrowDown } from "react-icons/md";
import { eventSchema, eventSchemas } from "@/services/eventSchema";
import styles from "./EventSourceList.module.scss";

export interface Props {
  selected?: SchemaFormat;
  onSelect: (schema: eventSchema) => void;
}

export default function EventSourceList({ onSelect, selected }: Props) {
  const [expand, setExpand] = useState(false);

  return (
    <>
      <div
        className="d-flex flex-wrap align-items-stretch align-middle row mb-3"
        style={{
          maxHeight: expand ? 999 : 240,
          overflow: "hidden",
          position: "relative",
          transition: "max-height 0.5s",
        }}
      >
        {eventSchemas.map((s, i) => (
          <div className={`col-4`} key={i + s.value}>
            <a
              href="#"
              title={s.label}
              onClick={(e) => {
                e.preventDefault();
                onSelect(s);
              }}
              className={`${styles.eventCard} btn btn-light-hover btn-outline-${
                s.value === selected ? "selected" : "primary"
              } mb-3`}
              style={{
                backgroundImage: `url(${s.logo})`,
              }}
            />
          </div>
        ))}
        {!expand && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 50,
              textAlign: "center",
              background:
                "linear-gradient(transparent, var(--surface-background-color))",
              cursor: "pointer",
            }}
            className="text-primary"
            onClick={(e) => {
              e.preventDefault();
              setExpand(true);
            }}
          />
        )}
      </div>
      {!expand && (
        <div
          className="text-center mb-3 cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            setExpand(true);
          }}
        >
          <a href="#" className="display-block">
            Show All <MdKeyboardArrowDown />
          </a>
        </div>
      )}
    </>
  );
}
