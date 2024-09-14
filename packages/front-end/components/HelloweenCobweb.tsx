import { useHelloweenThemeContext } from "@/services/helloweenProvider";

//cobweb shown when helloween context is on
export default function HelloweenCobweb() {
  const { showHelloweenTheme } = useHelloweenThemeContext();

  return showHelloweenTheme ? (
    <div
      id="cobweb"
      style={{
        height: "100%",
        pointerEvents: "none",
        width: "539px",
        position: "fixed",
        top: "-60px",
        opacity: 0.27,
        zIndex: 10000,
        left: "-117px",
        background: "url(/images/helloween/cobweb.png) 0% 0% / 100% no-repeat",
      }}
    />
  ) : null;
}
