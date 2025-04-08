import React, { FC, useCallback, useState } from "react";
import { FaPencilAlt, FaPlus } from "react-icons/fa";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import { EditJupyterNotebookQueryRunner } from "@/components/Settings/EditDataSource/DataSourceJupypterQuery/EditJupyterNotebookQueryRunner";
import Code from "@/components/SyntaxHighlighting/Code";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

// 数据源 Jupyter Notebook 查询组件的属性类型
type DataSourceJupyterNotebookQueryProps = DataSourceQueryEditingModalBaseProps;

// 数据源 Jupyter Notebook 查询组件
export const DataSourceJupyterNotebookQuery: FC<DataSourceJupyterNotebookQueryProps> = ({
  onSave,
  dataSource,
  canEdit = true,
}) => {
  // 用于存储用户界面模式（查看或编辑）的状态
  const [uiMode, setUiMode] = useState<"view" | "edit">("view");
  const permissionsUtil = usePermissionsUtil();
  // 根据权限判断是否可以编辑
  canEdit = canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);

  // 处理取消编辑的回调函数
  const handleCancel = useCallback(() => {
    setUiMode("view");
  }, []);

  if (!dataSource) {
    console.error("实现错误：数据源不能为空");
    return null;
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center">
        <div className="">
          <h3>Jupyter Notebook 查询运行器</h3>
        </div>

        {canEdit && (
          <div className="">
            <button
              className="btn btn-outline-primary font-weight-bold"
              onClick={() => {
                setUiMode("edit");
              }}
            >
              {dataSource.settings.notebookRunQuery ? (
                <>
                  <FaPencilAlt className="mr-1" /> 编辑
                </>
              ) : (
                <>
                  <FaPlus className="mr-1" /> 添加
                </>
              )}
            </button>
          </div>
        )}
      </div>
      <p>
        告诉我们如何在 Jupyter notebook 环境中查询此数据源。
      </p>
      {dataSource.settings?.notebookRunQuery ? (
        <Code
          code={dataSource.settings.notebookRunQuery}
          language="python"
          expandable={true}
        />
      ) : (
        <div className="alert alert-info">
          用于将实验结果导出到 Jupyter notebook 时
        </div>
      )}

      {uiMode === "edit" ? (
        <EditJupyterNotebookQueryRunner
          onSave={onSave}
          onCancel={handleCancel}
          dataSource={dataSource}
        />
      ) : null}
    </div>
  );
};