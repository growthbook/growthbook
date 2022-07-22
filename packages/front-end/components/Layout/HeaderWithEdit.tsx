import { ReactElement } from "react";
import { GBEdit } from "../Icons";

export interface Props {
  h?: 1 | 2 | 3 | 4;
  children: string | ReactElement;
  edit?: () => void;
  additionalActions?: ReactElement;
}

export default function HeaderWithEdit({
  h = 3,
  children,
  edit,
  additionalActions,
}: Props) {
  const Component = h === 1 ? "h1" : h === 2 ? "h2" : h === 3 ? "h3" : "h4";

  return (
    <div className="d-flex align-items-center mb-2">
      <Component className="mb-0">{children}</Component>
      {edit && (
        <div className="ml-1">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              edit();
            }}
          >
            <GBEdit />
          </a>
        </div>
      )}
      {additionalActions && <div className="ml-1">{additionalActions}</div>}
    </div>
  );
}
