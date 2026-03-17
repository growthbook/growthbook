import React, { ReactElement, Children } from "react";
import { FixedSizeList as List } from "react-window";
import { MenuListProps, GroupBase } from "react-select";
import { SingleValue } from "@/components/Forms/SelectField";

const OPTION_HEIGHT = 36;
const MAX_VISIBLE_OPTIONS = 8;

export function VirtualizedMenuList(
  props: MenuListProps<SingleValue, true, GroupBase<SingleValue>>,
) {
  const { children, maxHeight } = props;
  const childArray = Children.toArray(children) as ReactElement[];

  if (!childArray.length) {
    return <div className="gb-multi-select__menu-list">{children}</div>;
  }

  const height = Math.min(
    maxHeight,
    childArray.length * OPTION_HEIGHT,
    MAX_VISIBLE_OPTIONS * OPTION_HEIGHT,
  );

  return (
    <List
      height={height}
      itemCount={childArray.length}
      itemSize={OPTION_HEIGHT}
      width="100%"
      className="gb-multi-select__menu-list"
    >
      {({ index, style }) => <div style={style}>{childArray[index]}</div>}
    </List>
  );
}
