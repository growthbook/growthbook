import { SDKLanguage } from "back-end/types/sdk-connection";
import SDKLanguageLogo from "@/components/Features/SDKConnections/SDKLanguageLogo";
import TabButton from "@/components/Tabs/TabButton";
import TabButtons from "@/components/Tabs/TabButtons";

export default function SDKLanguageTabs({
  language,
  setLanguage,
}: {
  language: SDKLanguage;
  setLanguage: (language: SDKLanguage) => void;
}) {
  const tabOrder: SDKLanguage[][] = [
    ["javascript", "react"],
    ["php", "ruby", "python", "java", "csharp", "go"],
    ["ios", "android", "flutter"],
  ];

  return (
    <div>
      {tabOrder.map((group, i) => (
        <TabButtons newStyle={true} key={i} className="mb-1">
          {group.map((l, j) => (
            <TabButton
              newStyle={true}
              className="px-2 pt-2 pb-1"
              key={l}
              active={l === language}
              display={
                <SDKLanguageLogo language={l} showLabel={true} size={30} />
              }
              onClick={() => setLanguage(l)}
              last={j === group.length - 1}
            />
          ))}
        </TabButtons>
      ))}
    </div>
  );
}
