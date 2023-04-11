import clsx from "clsx";
import Fuse from "fuse.js";
import { useRef, useState } from "react";
import { FaAngleDown } from "react-icons/fa";
import styles from "./TypeaheadInput.module.scss";

type Props = {
  label: string;
  value: string;
  items: { name: string; id: string }[];
  onChange: (e: string, id: string) => void;
  placeholder?: string;
};

export default function TypeaheadInput({
  label,
  value,
  items,
  onChange,
  placeholder = "received_at",
}: Props) {
  const [filteredItems, setFilteredItems] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);

  const fuse = new Fuse(items, {
    includeScore: false,
    keys: ["name"],
  });

  function formatItems(items) {
    return items.map((item) => {
      return {
        item: { name: item.name, id: item.id },
      };
    });
  }

  const inputRef = useRef(null);

  function handleClick() {
    if (showDropdown) {
      inputRef.current.blur();
    } else {
      setShowDropdown(true);
      if (!value && !filteredItems.length) {
        setFilteredItems(formatItems(items));
      }
    }
  }

  return (
    <div>
      <div className="d-flex flex-column pb-1">
        {label && <label>{label}</label>}
        <div className="input-group">
          <input
            className={clsx(styles.input, "form-control")}
            placeholder={placeholder}
            value={value}
            onClick={() => handleClick()}
            onChange={(e) => {
              const id = filteredItems.find(
                (item) => item.item.name === e.target.value
              )?.item.id;
              onChange(e.target.value, id || "");
              if (!e.target.value) {
                setFilteredItems(formatItems(items));
              } else {
                setFilteredItems(fuse.search(e.target.value));
              }
            }}
            ref={inputRef}
            onBlur={() => {
              setShowDropdown(false);
            }}
          />
          <div className={clsx(styles.caret, "input-group-append")}>
            {items.length > 0 && (
              <button
                className={clsx(styles.caretBtn, "btn btn-link form-control")}
                onMouseDown={() => {
                  setShowDropdown(!showDropdown);
                  if (!value && !filteredItems.length) {
                    setFilteredItems(formatItems(items));
                  }
                }}
                onBlur={() => {
                  if (showDropdown) {
                    setShowDropdown(false);
                  }
                }}
                type="button"
              >
                <FaAngleDown style={{ opacity: "25%" }} />
              </button>
            )}
          </div>
        </div>
      </div>
      {filteredItems.length > 0 && showDropdown && (
        <div className={clsx(styles.dropdown, "p-2 border rounded")}>
          {filteredItems.map((item, i) => {
            return (
              <li
                className={styles.dropdownItem}
                role="button"
                key={`${item.item.name}-${i}`}
                onMouseDown={() => onChange(item.item.name, item.item.id || "")}
              >
                {item.item.name}
              </li>
            );
          })}
        </div>
      )}
    </div>
  );
}
