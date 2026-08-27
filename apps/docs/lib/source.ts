import { docs } from "@/.source/server";
import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/plugins/lucide-icons";

// `icon` in a meta.json is a lucide name, resolved here so the sidebar and the
// cards on the landing page can share one vocabulary.
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});
