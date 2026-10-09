import type { Metadata } from "next";
import "./globals.css";
import "./personal.css";
import "./period.css";
export const metadata: Metadata = {
  title: "personal_news · 私人阅报室",
  description: "读报、划线，留下自己的想法。",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
