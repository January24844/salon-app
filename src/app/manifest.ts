import type { MetadataRoute } from "next";

// Dzięki temu klientki mogą "zainstalować" aplikację na telefonie.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mój Salon",
    short_name: "Mój Salon",
    description: "Rezerwacje wizyt online",
    start_url: "/",
    display: "standalone",
    background_color: "#FBF7F4",
    theme_color: "#B5838D",
    lang: "pl",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
