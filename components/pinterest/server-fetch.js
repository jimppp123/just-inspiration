import "server-only";
import https from "node:https";

const ALLOWED_HOSTS = new Set(["www.pinterest.com", "i.pinimg.com"]);
const CERTIFICATE_ERRORS = new Set([
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
]);

function validateUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error("远程地址不在允许列表中。");
  }
  return url;
}

function compatibleRequest(
  url,
  headers,
  maxBytes,
  redirects = 0,
  timeoutMs = 15000,
) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      validateUrl(url),
      {
        headers,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      (response) => {
        const location = response.headers.location;
        if (
          location &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          redirects < 3
        ) {
          response.resume();
          compatibleRequest(
            new URL(location, url),
            headers,
            maxBytes,
            redirects + 1,
            timeoutMs,
          ).then(resolve, reject);
          return;
        }

        const declared = Number(response.headers["content-length"] ?? 0);
        if (declared > maxBytes) {
          response.destroy();
          reject(new Error("远程内容超过大小限制。"));
          return;
        }

        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            response.destroy(new Error("远程内容超过大小限制。"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            headers: new Headers(response.headers),
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("远程请求超时。")));
    request.on("error", reject);
  });
}

export async function fetchPinterest(url, options = {}) {
  const target = validateUrl(url);
  const maxBytes = options.maxBytes ?? 12 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 15000;
  try {
    const response = await fetch(target, {
      cache: options.cache,
      headers: options.headers,
      next: options.next,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new Error("远程内容超过大小限制。");
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maxBytes) throw new Error("远程内容超过大小限制。");
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      body,
    };
  } catch (error) {
    if (!CERTIFICATE_ERRORS.has(error.cause?.code)) throw error;
    // Corporate TLS interception on the local machine lacks a Node-trusted
    // issuer. The host allow-list above keeps this fallback Pinterest-only.
    return compatibleRequest(target, options.headers, maxBytes, 0, timeoutMs);
  }
}
