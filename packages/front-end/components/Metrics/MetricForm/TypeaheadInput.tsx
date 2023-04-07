import clsx from "clsx";
import Fuse from "fuse.js";
import { useEffect, useRef, useState } from "react";
import styles from "./TableInput.module.scss";

type Props = {
  label: string;
  value: string;
  items: { name: string; id: string }[];
  onChange: (e: string, id: string) => void;
  filterKeys: string[];
  placeholder?: string;
};

export default function TypeaheadInput({
  label,
  value,
  items,
  onChange,
  filterKeys,
  placeholder = "received_at",
}: Props) {
  const [filteredItems, setFilteredItems] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);

  const fuse = new Fuse(items, {
    includeScore: false,
    keys: filterKeys,
  });

  const inputRef = useRef(null);

  function handleClick() {
    if (showDropdown) {
      inputRef.current.blur();
    } else {
      setShowDropdown(true);
      if (!value && !filteredItems.length) {
        setFilteredItems(items);
      }
    }
  }

  useEffect(() => {
    setFilteredItems(items);
  }, [items]);

  return (
    <div>
      <div className="d-flex flex-column">
        <label>{label}</label>
        <div className="d-flex">
          <input
            className={(styles.input, "form-control")}
            placeholder={placeholder}
            value={value}
            onClick={() => handleClick()}
            onChange={(e) => {
              onChange(e.target.value, "");
              if (!e.target.value) {
                setFilteredItems(items);
              } else {
                setFilteredItems(fuse.search(e.target.value));
              }
            }}
            ref={inputRef}
            onBlur={() => {
              setShowDropdown(false);
            }}
          />
        </div>
      </div>
      {filteredItems.length > 0 && showDropdown && (
        <div className={clsx(styles.dropdown, "p-2 border rounded")}>
          {filteredItems.map((item, i) => (
            <li
              className={styles.dropdownItem}
              role="button"
              key={`${item.item.name}-${i}`}
              onMouseDown={() => onChange(item.item.name, item.item.id || "")}
            >
              {item.item.name}
            </li>
          ))}
        </div>
      )}
    </div>
  );
}
