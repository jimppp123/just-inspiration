import { NextResponse } from "next/server";
import { parseBoardUrl } from "@/components/pinterest/boards";
import { fetchPinterest } from "@/components/pinterest/server-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const MAX_PINS = 200;
const MAX_PAGES = 8;

function extractScript(html, id) {
  const match = html.match(
    new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`),
  );
  if (!match) throw new Error("Pinterest 没有返回公开画板数据。");
  return JSON.parse(match[1]);
}

function findBoardFeed(resources) {
  const variants = resources?.BoardFeedResource;
  if (!variants || typeof variants !== "object") return null;
  return Object.values(variants).find((entry) => Array.isArray(entry?.data));
}

function getCookies(headers) {
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie") ?? ""];
  const cookies = new Map();
  for (const value of values) {
    for (const match of value.matchAll(
      /(?:^|,\s*)(csrftoken|_pinterest_sess|_auth|_routing_id)=([^;,\s]+)/g,
    )) {
      cookies.set(match[1], `${match[1]}=${match[2]}`);
    }
  }
  return [...cookies.values()].join("; ");
}

function getResourceOptions(resources, feed) {
  const variants = resources?.BoardFeedResource ?? {};
  const key = Object.keys(variants).find((entry) => variants[entry] === feed);
  if (!key) return {};
  try {
    return Object.fromEntries(JSON.parse(key));
  } catch {
    return {};
  }
}

function imageKey(pin) {
  const source =
    pin?.images?.orig?.url ??
    pin?.images?.["736x"]?.url ??
    pin?.images?.["236x"]?.url;
  if (!source) return "";
  try {
    return new URL(source).pathname.split("/").pop()?.toLowerCase() ?? "";
  } catch {
    return source.split(/[?#]/, 1)[0].toLowerCase();
  }
}

function addPins(target, seenPins, seenImages, entries) {
  for (const pin of entries ?? []) {
    const id = String(pin?.id ?? "");
    const image = imageKey(pin);
    if (
      !/^\d+$/.test(id) ||
      !pin?.images ||
      seenPins.has(id) ||
      (image && seenImages.has(image))
    )
      continue;
    seenPins.add(id);
    if (image) seenImages.add(image);
    target.push(pin);
  }
}

async function fetchNextPage({
  boardUrl,
  boardId,
  bookmark,
  cookies,
  csrfToken,
  handler,
  appVersion,
  options,
}) {
  const endpoint = new URL("/resource/BoardFeedResource/get/", boardUrl.origin);
  endpoint.searchParams.set("source_url", boardUrl.pathname);
  endpoint.searchParams.set(
    "data",
    JSON.stringify({
      options: {
        ...options,
        board_id: boardId,
        page_size: 25,
        bookmarks: [bookmark],
      },
      context: {},
    }),
  );
  endpoint.searchParams.set("_", String(Date.now()));

  const response = await fetchPinterest(endpoint, {
    cache: "no-store",
    maxBytes: 5 * 1024 * 1024,
    headers: {
      Accept: "application/json",
      Cookie: cookies,
      Referer: boardUrl.href,
      "User-Agent": USER_AGENT,
      "X-App-Version": appVersion,
      "X-CSRFToken": csrfToken,
      "X-Pinterest-PWS-Handler": handler,
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  if (!response.ok) {
    throw new Error(`Pinterest 分页返回 ${response.status}`);
  }
  const payload = JSON.parse(response.body.toString("utf8"));
  const resource = payload.resource_response;
  if (resource?.status !== "success" || !Array.isArray(resource.data)) {
    throw new Error("Pinterest 分页数据无法读取。");
  }
  return {
    data: resource.data,
    bookmark:
      resource.bookmark ?? payload.resource?.options?.bookmarks?.[0] ?? null,
  };
}

export async function GET(request) {
  let parsed;
  try {
    parsed = parseBoardUrl(request.nextUrl.searchParams.get("url") ?? "");
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  try {
    const response = await fetchPinterest(parsed.url, {
      cache: "no-store",
      maxBytes: 5 * 1024 * 1024,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      throw new Error(`Pinterest 返回 ${response.status}`);
    }

    const html = response.body.toString("utf8");
    const props = extractScript(html, "__PWS_INITIAL_PROPS__");
    const pws = extractScript(html, "__PWS_DATA__");
    const state = props.initialReduxState;
    const feed = findBoardFeed(state?.resources);
    const board =
      Object.values(state?.boards ?? {}).find(
        (entry) => entry?.type === "board",
      ) ?? null;
    if (!board || !feed) throw new Error("这个画板没有可读取的公开收藏。");

    const rawPins = [];
    const seenPins = new Set();
    const seenImages = new Set();
    addPins(rawPins, seenPins, seenImages, feed.data);

    const boardUrl = new URL(parsed.url);
    const cookies = getCookies(response.headers);
    const csrfToken = cookies.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1] ?? "";
    const options = getResourceOptions(state?.resources, feed);
    let bookmark = feed.nextBookmark;
    let page = 1;

    while (
      bookmark &&
      bookmark !== "-end-" &&
      rawPins.length < MAX_PINS &&
      page < MAX_PAGES
    ) {
      try {
        const next = await fetchNextPage({
          boardUrl,
          boardId: String(board.id),
          bookmark,
          cookies,
          csrfToken,
          handler: pws.initialHandlerId,
          appVersion: pws.appVersion,
          options,
        });
        addPins(rawPins, seenPins, seenImages, next.data);
        bookmark = next.bookmark;
        page++;
      } catch (error) {
        console.warn("[pinterest] stopped pagination:", error.message);
        break;
      }
    }

    const pins = rawPins
      .slice(0, MAX_PINS)
      .map((pin, index) => {
        const image = pin.images["736x"] ?? pin.images.orig;
        const thumb = pin.images["236x"] ?? image;
        if (!image?.url) return null;
        return {
          id: String(pin.id),
          width: image.width,
          height: image.height,
          dominantColor: pin.dominant_color,
          file: `/api/pinterest/image?url=${encodeURIComponent(image.url)}`,
          thumb: `/api/pinterest/image?url=${encodeURIComponent(thumb.url)}`,
          source: pin.images.orig?.url ?? image.url,
          url: `https://www.pinterest.com/pin/${pin.id}/`,
          name: `${board.name} ${String(index + 1).padStart(2, "0")}`,
          type: board.name,
        };
      })
      .filter(Boolean);

    if (pins.length < 2) {
      throw new Error("这个画板没有足够的公开图片来生成轮盘。");
    }

    return NextResponse.json(
      {
        board: {
          id: String(board.id),
          name: board.name || parsed.name,
          url: parsed.url,
          owner: board.owner?.username ?? "",
          totalPins: Number(board.pin_count) || pins.length,
          importedPins: pins.length,
          hasMore:
            bookmark !== "-end-" && pins.length < Number(board.pin_count),
        },
        projects: pins,
      },
      {
        headers: {
          "Cache-Control": "private, max-age=300",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "画板读取失败，请稍后重试。" },
      { status: 502 },
    );
  }
}
