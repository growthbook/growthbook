import { ReactNode, FC } from "react";

const RightRailSection: FC<{
  open?: () => void;
  title: string | ReactNode;
  canOpen?: boolean;
  children: ReactNode;
}> = ({ open, title, children, canOpen = false }) => {
  return (
    <div>
      {open && canOpen && (
        <a
          href="#"
          className="float-right text-purple font-weight-semibold"
          onClick={(e) => {
            e.preventDefault();
            open();
          }}
        >
          Edit
        </a>
      )}
      <h4>{title}</h4>
      {children}
    </div>
  );
};

export default RightRailSection;
