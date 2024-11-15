import Link from "next/link";
import { OrganizationSettings } from "back-end/types/organization";
import { FaUpload } from "react-icons/fa";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "@/types/app-features";
import { DocLink } from "@/components/DocLink";
import BackupConfigYamlButton from "@/components/Settings/BackupConfigYamlButton";
import RestoreConfigYamlButton from "@/components/Settings/RestoreConfigYamlButton";

export default function ImportSettings({
    hasFileConfig,
    isCloud,
    settings,
    refreshOrg,
}: {
    hasFileConfig: boolean;
    isCloud: boolean;
    settings: OrganizationSettings;
    refreshOrg: () => Promise<void>;
}) {
    const growthbook = useGrowthBook<AppFeatures>();

    // 这里直接返回空内容，因为要删除的两个部分都基于条件判断，现在直接去掉这两个条件判断块的逻辑
    return null;

    // 以下是原始代码中被删除的部分，保留在此处作为参考方便你对比查看

    // {hasFileConfig && (
    //     <div className="alert alert-info my-3">
    //         以下设置是通过您的 <code>config.yml</code> 文件控制的，无法通过Web界面进行更改。{" "}
    //         <DocLink
    //             docSection="config_organization_settings"
    //             className="font-weight-bold"
    //         >
    //             查看文档
    //         </DocLink>
    //         。
    //     </div>
    // )}

    // {!hasFileConfig && (
    //     <div className="alert alert-info my-3">
    //         <h3>导入/导出config.yml</h3>
    //         <p>
    //             {isCloud? "GrowthBook云存储" : "您目前正在存储"}所有组织设置、数据源、指标和维度到一个数据库中。
    //         </p>
    //         <p>
    //             您可以将这些设置导入/导出到一个 <code>config.yml</code> 文件中，以便更轻松地在GrowthBook云账户和/或自托管环境之间迁移。{" "}
    //             <DocLink docSection="config_yml" className="font-weight-bold">
    //                 了解更多
    //             </DocLink>
    //         </p>
    //         <div className="row mb-3">
    //             <div className="col-auto">
    //                 <BackupConfigYamlButton settings={settings} />
    //             </div>
    //             <div className="col-auto">
    //                 <RestoreConfigYamlButton
    //                     settings={settings}
    //                     mutate={refreshOrg}
    //                 />
    //             </div>
    //         </div>
    //         <div className="text-muted">
    //             <strong>注意：</strong> 出于安全原因，导出的文件不包含数据源连接密码等机密信息。您必须自行编辑文件并添加这些信息。
    //         </div>
    //     </div>
    // )}

    // {growthbook?.getFeatureValue("import-from-x", false) && (
    //     <div className="bg-white p-3 border position-relative my-3">
    //         <h3>从其他服务导入</h //         <p>
    //             从其他特性标记和/或实验服务导入您的数据。
    //         </p>
    //         <Link href="/importing" className="btn btn-primary">
    //             <FaUpload className="mr-1" /> 从其他服务导入
    //         </Link>
    //     </div>
    // )}
}