import { ScrollViewStyleReset } from 'expo-router/html';

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        <title>股票分析</title>
        <meta name="description" content="台美股即時分析工具" />

        {/* PWA manifest */}
        <link rel="manifest" href="/manifest.json" />

        {/* iOS 主畫面圖示 */}
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="股票" />

        {/* Theme color */}
        <meta name="theme-color" content="#2C3E50" />

        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
