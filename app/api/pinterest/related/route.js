import { NextResponse } from "next/server";
import { fetchPinterest } from "@/components/pinterest/server-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const cache = new Map();
const pending = new Map();
const TTL = 10 * 60 * 1000;

function script(html, id) {
  const match = html.match(
    new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`),
  );
  return match ? JSON.parse(match[1]) : {};
}

function normalize(pin) {
  if (
    !/^\d+$/.test(String(pin?.id)) ||
    pin.promoted_is_lead_ad ||
    pin.campaign_id
  )
    return null;
  const image = pin.images?.["736x"] ?? pin.images?.orig;
  const thumb = pin.images?.["474x"] ?? image;
  if (!image?.url || !thumb?.url) return null;
  const source = new URL(image.url);
  if (source.protocol !== "https:" || source.hostname !== "i.pinimg.com")
    return null;
  return {
    id: String(pin.id),
    name: pin.grid_title || pin.title || "关联灵感",
    width: image.width,
    height: image.height,
    file: `/api/pinterest/image?url=${encodeURIComponent(image.url)}`,
    thumb: `/api/pinterest/image?url=${encodeURIComponent(thumb.url)}`,
    source: pin.images.orig?.url ?? image.url,
    dominantColor: pin.dominant_color,
    url: `https://www.pinterest.com/pin/${pin.id}/`,
  };
}

async function relatedPins(id) {
  const pinUrl = `https://www.pinterest.com/pin/${id}/`;
  const page = await fetchPinterest(pinUrl, {
    cache: "no-store",
    maxBytes: 8 * 1024 * 1024,
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!page.ok) throw new Error("Pinterest 图片页暂时不可用，请稍后重试。");
  const pws = script(page.body.toString("utf8"), "__PWS_DATA__");
  const cookieHeaders = page.headers.getSetCookie?.() ?? [
    page.headers.get("set-cookie") ?? "",
  ];
  const cookies = cookieHeaders
    .flatMap((line) => [
      ...line.matchAll(
        /(?:^|,\s*)(csrftoken|_pinterest_sess|_auth|_routing_id)=([^;,\s]+)/g,
      ),
    ])
    .map((match) => `${match[1]}=${match[2]}`)
    .join("; ");
  const endpoint = new URL(
    "https://www.pinterest.com/resource/RelatedPinFeedResource/get/",
  );
  endpoint.searchParams.set("source_url", `/pin/${id}/`);
  endpoint.searchParams.set(
    "data",
    JSON.stringify({
      options: {
        pin: id,
        page_size: 40,
        field_set_key: "react_grid_pin",
        add_vase: true,
      },
      context: {},
    }),
  );
  const response = await fetchPinterest(endpoint, {
    cache: "no-store",
    maxBytes: 8 * 1024 * 1024,
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      Referer: pinUrl,
      Cookie: cookies,
      "X-CSRFToken": cookies.match(/csrftoken=([^;]+)/)?.[1] ?? "",
      "X-App-Version": pws.appVersion ?? "",
      "X-Pinterest-PWS-Handler": pws.initialHandlerId ?? "www/pin/[id].js",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  if (!response.ok)
    throw new Error("Pinterest 关联图片暂时不可用，请稍后重试。");
  const payload = JSON.parse(response.body.toString("utf8")).resource_response;
  if (payload?.status !== "success" || !Array.isArray(payload.data))
    throw new Error("Pinterest 暂未返回这张图片的相关推荐。");
  const unique = new Map();
  for (const item of payload.data) {
    const pin = normalize(item);
    if (pin && pin.id !== id) unique.set(pin.id, pin);
  }
  // Only this Pin's recommendation feed is used; board neighbours are not
  // a substitute for Pinterest's relationship data.
  return {
    seedId: id,
    source: "pinterest-related",
    projects: [...unique.values()].slice(0, 30),
  };
}

export async function GET(request) {
  const id = request.nextUrl.searchParams.get("pin");
  if (!/^\d{5,25}$/.test(id ?? ""))
    return NextResponse.json({ error: "Pin ID 无效。" }, { status: 400 });
  try {
    let data = cache.get(id);
    if (!data || data.until < Date.now()) {
      if (!pending.has(id))
        pending.set(
          id,
          relatedPins(id).finally(() => pending.delete(id)),
        );
      const result = await pending.get(id);
      data = { until: Date.now() + TTL, result };
      cache.set(id, data);
      if (cache.size > 100) cache.delete(cache.keys().next().value);
    }
    return NextResponse.json(data.result, {
      headers: { "Cache-Control": "private, max-age=600" },
    });
  } catch {
    return NextResponse.json(
      { error: "暂时无法载入 Pinterest 关联图片，请重试或打开原图查看。" },
      { status: 502 },
    );
  }
}
