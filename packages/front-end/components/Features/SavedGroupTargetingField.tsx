import { SavedGroupTargeting } from "back-end/types/feature";
import { FaMinusCircle, FaPlusCircle } from "react-icons/fa";
import React from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import LargeSavedGroupPerformanceWarning, {
  useLargeSavedGroupSupport,
} from "@/components/SavedGroups/LargeSavedGroupSupportWarning";

// 定义属性接口
export interface Props {
  value: SavedGroupTargeting[];
  setValue: (savedGroups: SavedGroupTargeting[]) => void;
  project: string;
}

export default function SavedGroupTargetingField({
  value,
  setValue,
  project,
}: Props) {
  const { savedGroups, getSavedGroupById } = useDefinitions();

  const {
    supportedConnections,
    unsupportedConnections,
    hasLargeSavedGroupFeature,
  } = useLargeSavedGroupSupport(project);

  if (!savedGroups.length)
    return (
      <div>
        <label>按已保存的分组进行目标定位</label>
        <div className="font-italic text-muted mr-3">
          您没有任何已保存的分组。
        </div>
      </div>
    );

  const filteredSavedGroups = savedGroups.filter((group) => {
    return (
      !project || !group.projects?.length || group.projects.includes(project)
    );
  });

  const options = filteredSavedGroups.map((s) => ({
    value: s.id,
    label: s.groupName,
  }));

  const conflicts = getSavedGroupTargetingConflicts(value);

  if (value.length === 0) {
    return (
      <div>
        <label>按已保存的分组进行目标定位</label>
        <div className="font-italic text-muted mr-3">
          未应用任何已保存分组的目标定位。
        </div>
        <div
          className="d-inline-block ml-1 mt-2 link-purple font-weight-bold cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            setValue([
              ...value,
              {
                match: "any",
                ids: [],
              },
            ]);
          }}
        >
          <FaPlusCircle className="mr-1" />
          添加分组目标定位
        </div>
      </div>
    );
  }

  return (
    <div className="form-group my-4">
      <label>按已保存的分组进行目标定位</label>
      <div className="mb-1">
        <LargeSavedGroupPerformanceWarning
          style="text"
          hasLargeSavedGroupFeature={hasLargeSavedGroupFeature}
          supportedConnections={supportedConnections}
          unsupportedConnections={unsupportedConnections}
        />
      </div>
      <div>
        <div className="appbox bg-light px-3 py-3">
          {conflicts.length > 0 && (
            <div className="alert alert-danger">
              <strong>错误：</strong>您的规则与以下分组存在冲突：{" "}
              {conflicts.map((c) => (
                <span key={c} className="badge badge-danger mr-1">
                  {getSavedGroupById(c)?.groupName || c}
                </span>
              ))}
            </div>
          )}
          {value.map((v, i) => {
            return (
              <div className="row align-items-center mb-3" key={i}>
                <div className="col-auto" style={{ width: 70 }}>
                  {i === 0 ? "且" : "并且"}
                </div>
                <div className="col-auto">
                  <SelectField
                    value={v.match}
                    onChange={(match) => {
                      const newValue = [...value];
                      newValue[i] = { ...v };
                      newValue[i].match = match as "all" | "any" | "none";
                      setValue(newValue);
                    }}
                    sort={false}
                    options={[
                      {
                        value: "any",
                        label: "任意的",
                      },
                      {
                        value: "all",
                        label: "全部的",
                      },
                      {
                        value: "none",
                        label: "无",
                      },
                    ]}
                  />
                </div>
                <div className="col">
                  <MultiSelectField
                    value={v.ids}
                    onChange={(ids) => {
                      const newValue = [...value];
                      newValue[i] = { ...v };
                      newValue[i].ids = ids;
                      setValue(newValue);
                    }}
                    options={options}
                    required
                    placeholder="选择分组..."
                    closeMenuOnSelect={true}
                  />
                </div>
                <div className="col-auto ml-auto">
                  <button
                    className="btn btn-link text-danger"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      const newValue = [...value];
                      newValue.splice(i, 1);
                      setValue(newValue);
                    }}
                  >
                    <FaMinusCircle className="mr-1" />
                    删除
                  </button>
                </div>
              </div>
            );
          })}
          <span
            className="link-purple font-weight-bold cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              setValue([
                ...value,
                {
                  match: "any",
                  ids: [],
                },
              ]);
            }}
          >
            <FaPlusCircle className="mr-1" />
            添加另一个条件
          </span>
        </div>
      </div>
    </div>
  );
}

export function getSavedGroupTargetingConflicts(
  savedGroups: SavedGroupTargeting[]
): string[] {
  const required = new Set<string>();
  const excluded = new Set<string>();
  savedGroups.forEach((rule) => {
    if (rule.match === "all" || rule.match === "any") {
      rule.ids.forEach((id) => required.add(id));
    } else if (rule.match === "none") {
      rule.ids.forEach((id) => excluded.add(id));
    }
  });

  // 如果所需分组和排除分组之间存在重叠，就存在冲突
  return Array.from(required).filter((id) => excluded.has(id));
}

export function validateSavedGroupTargeting(
  savedGroups?: SavedGroupTargeting[]
) {
  if (!savedGroups) return;

  if (savedGroups.some((g) => g.ids.length === 0)) {
    throw new Error("不能有空的已保存分组目标定位规则。");
  }

  if (getSavedGroupTargetingConflicts(savedGroups).length > 0) {
    throw new Error(
      "请在保存之前解决已保存分组规则中的冲突"
    );
  }
}