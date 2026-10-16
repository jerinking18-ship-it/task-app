import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "BGM Task App",
    short_name: "BGM Task",
    description: "Your church team’s tasks, meetings and assignments.",
    lang: "en",
    start_url: "/account",
    scope: "/",
    display: "standalone",
    background_color: "#f7f5f0",
    theme_color: "#101c2d",
    prefer_related_applications: false,
    icons: [
      { src: "/icons/app-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/app-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
