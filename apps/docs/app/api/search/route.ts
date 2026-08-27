import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

// Static index built at request time from the same loader the sidebar uses,
// so nothing external is needed for search.
export const { GET } = createFromSource(source);
