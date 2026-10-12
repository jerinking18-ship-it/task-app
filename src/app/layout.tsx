import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Task App",
  description: "A personal task app for web and mobile.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
