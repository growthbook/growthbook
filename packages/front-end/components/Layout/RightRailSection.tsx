import { ReactNode, FC } from "react";
import Link from "@/ui/Link";

const RightRailSection: FC<{
  open?: () => void;
  title: string | ReactNode;
  canOpen?: boolean;
  children: ReactNode;
}> = ({ open, title, children, canOpen = false }) => {
  return (
    <div>
      {open && canOpen && (
        <Link
          className="float-right text-purple font-weight-semibold"
          onClick={() => open()}
        >
          Edit
        </Link>
      )}
      <h4>{title}</h4>
      {children}
    </div>
  );
};

export default RightRailSection;
