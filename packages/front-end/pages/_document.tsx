import { Html, Head, Main, NextScript } from "next/document";
import { AppearanceUISnippet } from "@/services/AppearanceUIThemeProvider";

export default function Document() {
  return (
    <Html>
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
