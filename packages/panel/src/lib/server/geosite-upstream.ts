type GeositeServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

type PlatformWithGeosite = {
  env?: {
    GEOSITE_API?: GeositeServiceBinding;
  };
};

function getGeositeServiceBinding(
  platform: unknown,
): GeositeServiceBinding | null {
  const candidate = (platform as PlatformWithGeosite | undefined)?.env
    ?.GEOSITE_API;
  if (candidate && typeof candidate.fetch === "function") {
    return candidate;
  }
  return null;
}

export function isSurgeHost(hostname: string): boolean {
  return hostname === "surge.slinet.moe";
}

export async function fetchGeositeUpstream({
  request,
  url,
  platform,
}: {
  request: Request;
  url: URL;
  platform: unknown;
}): Promise<Response> {
  const accept = request.headers.get("accept") ?? "*/*";
  const serviceBinding = getGeositeServiceBinding(platform);

  if (!serviceBinding) {
    throw new Error("Missing required Cloudflare service binding: GEOSITE_API");
  }

  // 当请求来自 surge.slinet.moe 时，将路径重写到 /surge/ 前缀
  let internalPath = `${url.pathname}${url.search}`;
  if (isSurgeHost(url.hostname)) {
    if (url.pathname.startsWith("/geosite")) {
      internalPath = `/surge${url.pathname}${url.search}`;
    } else if (url.pathname.startsWith("/geoip")) {
      internalPath = `/surge${url.pathname}${url.search}`;
    }
  }

  const internalUrl = `https://geosite.internal${internalPath}`;
  return serviceBinding.fetch(internalUrl, {
    headers: {
      accept,
    },
  });
}
