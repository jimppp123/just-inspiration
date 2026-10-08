import { NextResponse } from "next/server";
import { fetchPinterest } from "@/components/pinterest/server-fetch";

export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_GIF_BYTES = 24 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export async function GET(request) {
  let source;
  try {
    source = new URL(request.nextUrl.searchParams.get("url") ?? "");
  } catch {
    return NextResponse.json({ error: "图片地址无效。" }, { status: 400 });
  }

  if (
    source.protocol !== "https:" ||
    source.hostname !== "i.pinimg.com" ||
    !/^\/(?:236x|474x|736x|originals)\//.test(source.pathname)
  ) {
    return NextResponse.json(
      { error: "只允许读取 Pinterest 图片。" },
      { status: 400 },
    );
  }

  try {
    const animated = /\.gif$/i.test(source.pathname);
    const maxBytes = animated ? MAX_GIF_BYTES : MAX_BYTES;
    const response = await fetchPinterest(source, {
      maxBytes,
      timeoutMs: animated ? 15000 : 5000,
      next: { revalidate: 86400 },
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) throw new Error(`Pinterest 返回 ${response.status}`);

    const contentType = response.headers.get("content-type") ?? "";
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (!contentType.startsWith("image/") || declaredSize > maxBytes) {
      throw new Error("图片格式或大小不受支持。");
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Pinterest 图片读取失败。" },
      { status: 502 },
    );
  }
}
