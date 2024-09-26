import {
  ComponentType,
  ReactNode,
  FC,
  isValidElement,
  cloneElement,
} from "react";

const ConditionalWrapper: FC<{
  condition: boolean;
  wrapper?: ComponentType<{ children: ReactNode }> | ReactNode;
  children: ReactNode;
}> = ({ condition, wrapper, children }) => {
  if (condition && wrapper) {
    if (isValidElement(wrapper)) {
      return cloneElement(wrapper, {}, children);
    } else if (typeof wrapper === "function") {
      const Component = wrapper as ComponentType<{ children: ReactNode }>;
      return <Component>{children}</Component>;
    }
  }
  return <>{children}</>;
};

export default ConditionalWrapper;
