// Bounded Graph API helpers shared by the Meta providers (Facebook, Instagram).
// Without a timeout and a page cap, a Graph account with a huge or cyclic
// `paging.next` chain makes pages() hang forever.
export const GRAPH_TIMEOUT_MS = 10000;
export const GRAPH_MAX_PAGES = 20;

export const graphFetch = async (url: string, timeoutMs = GRAPH_TIMEOUT_MS) =>
  (await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })).json();

// Follows `paging.next` (max `maxPages`, stops on an empty or repeated url) and
// returns all `data` entries.
export const graphPaginate = async (
  startUrl: string,
  opts: { maxPages?: number; timeoutMs?: number } = {}
) => {
  const { maxPages = GRAPH_MAX_PAGES, timeoutMs = GRAPH_TIMEOUT_MS } = opts;
  const seenUrls = new Set<string>();
  const items: any[] = [];
  let nextUrl: string | undefined = startUrl;
  while (nextUrl && !seenUrls.has(nextUrl) && seenUrls.size < maxPages) {
    seenUrls.add(nextUrl);
    const response: any = await graphFetch(nextUrl, timeoutMs);
    if (Array.isArray(response.data)) {
      items.push(...response.data);
    }
    nextUrl = response.paging?.next;
  }
  return items;
};
