import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "高康盃報名系統｜產品展示",
  description: "高康盃報名系統",
  icons: { icon: "/brand/favicon-k.svg", shortcut: "/brand/favicon-k.svg", apple: "/brand/favicon-k.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
