import Button from "@/components/Radix/Button";

// 组件属性接口定义
export interface Props {
  // 编辑结果的函数，可选
  editResult?: () => void;
  // 编辑目标设定的函数（可能为null）
  editTargeting?: (() => void) | null;
  // 是否是多臂老虎机实验，可选
  isBandit?: boolean;
}

// 实验操作按钮组件
export default function ExperimentActionButtons({
  editResult,
  editTargeting,
  isBandit,
}: Props) {
  return (
    <div className="d-flex ml-2">
      <Button
        // 右边距为3
        mr="3"
        // 如果编辑目标设定函数不存在则禁用按钮
        disabled={!editTargeting}
        // 点击时调用编辑目标设定函数
        onClick={() => editTargeting?.()}
      >
        编辑
      </Button>
      <Button
        // 按钮变体为轮廓样式
        variant="outline"
        // 点击时调用编辑结果函数
        onClick={() => editResult?.()}
        // 如果编辑结果函数不存在则禁用按钮
        disabled={!editResult}
      >
        {isBandit
          ? "停止多臂老虎机实验"
          : "停止实验"}
      </Button>
    </div>
  );
}