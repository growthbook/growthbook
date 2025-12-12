import { Html, Head, Main, NextScript } from "next/document";
import { AppearanceUISnippet } from "@/services/AppearanceUIThemeProvider";

export default function Document() {
  return (
    // NB: The AppearanceUISnippet modifies the <html> element
    // so we suppress hydration warnings so React does not attempt to patch
    // our changes.
    // This applies only to the <html> element, not affecting any of the children.
    <Html suppressHydrationWarning>
      <Head>
        <script
          dangerouslySetInnerHTML={{
            __html: AppearanceUISnippet,
          }}
        />
        <style>
          {`
            html.light-theme {
              background-color: #faf8ff;
            }
            html.dark-theme {
              background-color: #10172e;
            }
          `}
        </style>
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
