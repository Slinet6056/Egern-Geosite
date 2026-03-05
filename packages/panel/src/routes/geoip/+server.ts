import type { RequestHandler } from "@sveltejs/kit";
import { fetchGeositeUpstream } from "$lib/server/geosite-upstream";

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const response = await fetchGeositeUpstream({
    request,
    url,
    platform,
  });

  const body = await response.arrayBuffer();
  const headers = new Headers();

  for (const key of [
    "content-type",
    "content-disposition",
    "cache-control",
    "etag",
    "x-upstream-etag",
    "x-stale",
    "x-no-resolve",
  ]) {
    const value = response.headers.get(key);
    if (value) {
      headers.set(key, value);
    }
  }

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
