import inspiration from "../../public/pinterest/ai-inspiration.json";

const STORAGE_KEY = "ice-works.pinterest-boards.v1";
const CHANGE_EVENT = "ice-works:boards-changed";
export const PRIMARY_BOARD = {
  url: inspiration.board.url,
  name: inspiration.board.name,
  primary: true,
};
const DEFAULT_BOARDS = [PRIMARY_BOARD];
const RESERVED = new Set([
  "pin",
  "ideas",
  "search",
  "settings",
  "business",
  "today",
  "login",
  "logout",
  "signup",
  "help",
  "about",
  "following",
  "explore",
]);
let lastRaw;
let lastBoards = DEFAULT_BOARDS;
const boardRequests = new Map();

export function parseBoardUrl(value) {
  const input = value.trim();
  let url;
  try {
    url = new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    throw new Error("请输入完整的 Pinterest 画板链接。");
  }
  const host = url.hostname.replace(/^www\./, "");
  const validHost =
    /^pinterest\.(com|co\.uk|com\.au|ca|de|fr|it|es|jp|pt)$/.test(host);
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    !validHost ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    parts.length !== 2 ||
    RESERVED.has(parts[0].toLowerCase()) ||
    parts[1].startsWith("_")
  ) {
    throw new Error("请使用画板页链接，例如 pinterest.com/用户名/画板名/。");
  }
  let slug;
  try {
    slug = decodeURIComponent(parts[1]);
  } catch {
    throw new Error("画板链接无法识别，请从 Pinterest 重新复制。");
  }
  return {
    url: `https://www.${host}/${parts.join("/")}/`,
    name: slug.replace(/[-_]+/g, " ").slice(0, 60),
  };
}

export function getBoards() {
  if (typeof window === "undefined") return DEFAULT_BOARDS;
  let raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return DEFAULT_BOARDS;
  }
  if (raw === lastRaw) return lastBoards;
  lastRaw = raw;
  try {
    const saved = JSON.parse(raw);
    const unique = new Map([[PRIMARY_BOARD.url, PRIMARY_BOARD]]);
    if (Array.isArray(saved)) {
      for (const board of saved.slice(0, 100)) {
        try {
          const parsed = parseBoardUrl(board.url);
          unique.set(parsed.url, {
            ...parsed,
            name:
              typeof board.name === "string" && board.name.trim()
                ? board.name.trim().slice(0, 60)
                : parsed.name,
          });
        } catch {
          // Old or malformed entries must not break the rest of the notebook.
        }
      }
    }
    lastBoards = [...unique.values()];
  } catch {
    lastBoards = DEFAULT_BOARDS;
  }
  return lastBoards;
}

export const getServerBoards = () => DEFAULT_BOARDS;

export function requestBoard(board) {
  if (!boardRequests.has(board.url)) {
    const request = fetch(
      `/api/pinterest/board?url=${encodeURIComponent(board.url)}`,
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "画板读取失败。");
        return {
          ...data,
          board: { ...data.board, name: board.name || data.board.name },
        };
      })
      .catch((error) => {
        boardRequests.delete(board.url);
        throw error;
      });
    boardRequests.set(board.url, request);
  }
  return boardRequests.get(board.url);
}

export function subscribeBoards(callback) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

export function saveBoards(boards) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(boards.filter((board) => !board.primary)),
    );
  } catch {
    throw new Error("浏览器暂时无法保存画板，请允许网站存储后重试。");
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
