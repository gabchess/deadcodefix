import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title:
    "deadcodefix — Firecrawl-Powered Harness Upgrade & Dead-Workaround Verifier",
  description:
    "Detect SDK & model doc drift with Firecrawl Change Tracking + Developer Index, prune obsolete workarounds & prompt sediment, and verify repairs with isolated B-vs-C supervisor checks.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
