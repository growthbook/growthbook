import { FC } from "react";
import { BsGear } from "react-icons/bs";

const RightRailSection: FC<{
  open?: () => void;
  title: string;
  canOpen?: boolean;
}> = ({ open, title, children, canOpen = false }) => {
  return (
    <div>
      {open && canOpen && (
        <a
          href="#"
          className="float-right"
          onClick={(e) => {
            e.preventDefault();
            open();
          }}
        >
          <BsGear />
        </a>
      )}
      <strong className="mb-2">{title}</strong>
      {children}
    </div>
  );
};

export default RightRailSection;
