import { useEffect, useState } from "react";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

export default function VercelIntegrationPage() {
	const permissionsUtil = usePermissionsUtil();

	const { data } = useApi<{ hasToken: boolean }>("/vercel/has-token");
	const [integrationAlreadyExists, setIntegrationAlreadyExists] =
		useState(false);

	useEffect(() => {
		if (data?.hasToken !== integrationAlreadyExists)
			setIntegrationAlreadyExists(!!data?.hasToken);
	}, [data]);

	if (!permissionsUtil.canManageIntegrations()) {
		return (
			<div className="container-fluid pagecontents">
				<div className="alert alert-danger">
					You do not have access to view this page.
				</div>
			</div>
		);
	}

	return (
		<>
			{integrationAlreadyExists ? (
				<h1>Vercel is integrated</h1>
			) : (
				<h1>
					Let&apos;s install Vercel for you.
					<div className="p-4">
						<a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fgrowthbook%2Fexamples%2Ftree%2Fmain%2Fnext-js&env=NEXT_PUBLIC_GROWTHBOOK_API_HOST,NEXT_PUBLIC_GROWTHBOOK_CLIENT_KEY&envDescription=SDK%20Connection%20Keys%20needed%20to%20connect%20with%20the%20GrowthBook%20API.&envLink=https%3A%2F%2Fapp.growthbook.io%2Fsdks&project-name=growthbook-nextjs-example&repository-name=growthbook-nextjs-example&redirect-url=https%3A%2F%2Fapp.growthbook.io%2Fsdks&developer-id=oac_6KG1d8FVno8cwoqGkcVMZdHk&production-deploy-hook=GrowthBook%20Deploy&demo-title=GrowthBook%20Next.js%20Example&integration-ids=oac_6KG1d8FVno8cwoqGkcVMZdHk">
							<img src="https://vercel.com/button" alt="Deploy with Vercel" />
						</a>
					</div>
				</h1>
			)}
		</>
	);
}
