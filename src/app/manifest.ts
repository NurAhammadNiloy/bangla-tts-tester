import type { MetadataRoute } from "next";

/** Lets Android (Chrome) and iOS (Safari → Share → Add to Home Screen) install the tester like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Golpo Studio",
    short_name: "Golpo Studio",
    description: "Test Bengali text-to-speech through OpenRouter with your own API key.",
    start_url: "/merge",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f5f2",
    theme_color: "#0f766e",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
