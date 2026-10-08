"use client";

import Image from "next/image";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getBoards,
  getServerBoards,
  parseBoardUrl,
  requestBoard,
  saveBoards,
  subscribeBoards,
} from "./pinterest/boards";
import { PINTEREST_BOARD, PROJECTS } from "./ring/projects";
import FocusExplorer from "./focus/FocusExplorer";
import MotionText from "./MotionText";
import BoardMenu from "./BoardMenu";
import ShelfLiquid from "./focus/ShelfLiquid";
import { transitionParams } from "./focus/params";
import { animateShelfTransition } from "./focus/shelfTransition";
import useLiquidDialog from "./useLiquidDialog";

const isAnimatedGif = (project) =>
  [project.source, project.file, project.thumb].some((source) =>
    /\.gif(?:$|[?#])/i.test(source || ""),
  );
const imageSrc = (p) => {
  if (p.preview?.src && !isAnimatedGif(p)) return p.preview.src;
  if (!p.source) return localImageSrc(p);
  const source = isAnimatedGif(p)
    ? p.source
    : p.source.replace("/originals/", "/736x/");
  return `/api/pinterest/image?url=${encodeURIComponent(source)}`;
};
const localImageSrc = (p) => {
  const local = p.thumb || p.file;
  return local.startsWith("/") ? local : `/${local}`;
};

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 18 18 6M6 6h12v12" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function PinImage({ project, animated }) {
  const [failed, setFailed] = useState(false);
  const fallback = localImageSrc(project);
  return (
    <Image
      src={failed ? fallback : imageSrc(project)}
      alt=""
      fill
      sizes="(max-width: 640px) 50vw, (max-width: 1100px) 25vw, 16vw"
      unoptimized
      loading="lazy"
      data-animated={animated ? "true" : undefined}
      onLoad={(event) => {
        const image = event.currentTarget;
        if (!image.naturalWidth || !image.naturalHeight) return;
        image
          .closest(".shelf-image")
          ?.style.setProperty(
            "--image-ratio",
            `${image.naturalWidth} / ${image.naturalHeight}`,
          );
      }}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}

export default function InspirationShelf({
  initialCollection,
  onBack,
  closing = false,
  onExited,
}) {
  const [collection, setCollection] = useState(
    initialCollection || { board: PINTEREST_BOARD, projects: PROJECTS },
  );
  const [switchingBoard, setSwitchingBoard] = useState("");
  const [selection, setSelection] = useState(null);
  const [focusClosing, setFocusClosing] = useState(false);
  const [entered, setEntered] = useState(false);
  const [boardError, setBoardError] = useState("");
  const [boardNotice, setBoardNotice] = useState("");
  const gridRef = useRef(null);
  const dialogRef = useRef(null);
  const boardDialog = useLiquidDialog(dialogRef);
  const scrollRef = useRef(null);
  const returnFocus = useRef(null);
  const transitions = useRef([]);
  const transitionFinished = useRef(Promise.resolve());
  const boards = useSyncExternalStore(
    subscribeBoards,
    getBoards,
    getServerBoards,
  );
  const boardUrl = collection.board.url;

  useLayoutEffect(() => {
    const root = scrollRef.current;
    const animations = animateShelfTransition(
      root,
      gridRef.current,
      transitionParams(),
      closing,
      transitions.current,
    );
    transitions.current = animations;
    let cancelled = false;
    transitionFinished.current = Promise.all(
      animations.map((animation) => animation.finished),
    );
    transitionFinished.current
      .then(() => {
        if (cancelled) return;
        if (closing) onExited?.();
        else {
          for (const animation of animations) {
            animation.effect.target.style.willChange = "";
            animation.cancel();
          }
          transitions.current = [];
          setEntered(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [closing, onExited]);

  useEffect(
    () => () => transitions.current.forEach((animation) => animation.cancel()),
    [],
  );

  const focusImage = (event, project) => {
    const card = event.currentTarget;
    const image = card.querySelector("img");
    const rect = card.getBoundingClientRect();
    const cx = rect.x + rect.width / 2,
      cy = rect.y + rect.height / 2;
    returnFocus.current = card;
    const measured = [...gridRef.current.querySelectorAll(".shelf-item")].map(
      (item) => ({ item, r: item.getBoundingClientRect() }),
    );
    for (const { item, r } of measured) {
      const dx = r.x + r.width / 2 - cx,
        dy = r.y + r.height / 2 - cy;
      const distance = Math.max(1, Math.hypot(dx, dy));
      item.style.setProperty("--exit-x", `${(dx / distance) * 100}px`);
      item.style.setProperty("--exit-y", `${(dy / distance) * 80}px`);
      item.style.setProperty(
        "--exit-delay",
        `${Math.min(120, distance * 0.06)}ms`,
      );
      item.dataset.selected = String(item === card);
    }
    setFocusClosing(false);
    setSelection({
      project,
      origin: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        src: image?.naturalWidth ? image.currentSrc : undefined,
        imageWidth: image?.naturalWidth,
        imageHeight: image?.naturalHeight,
      },
    });
  };
  const closeFocus = () => {
    setSelection(null);
    requestAnimationFrame(() =>
      returnFocus.current?.focus({ preventScroll: true }),
    );
  };
  const selectBoard = async (board) => {
    if (board.url === collection.board.url) return;
    setSwitchingBoard(board.url);
    setBoardError("");
    try {
      const data = await requestBoard(board);
      await boardDialog.close();
      setCollection(data);
      setSelection(null);
      scrollRef.current?.scrollTo(0, 0);
    } catch (err) {
      setBoardError(err.message);
      throw err;
    } finally {
      setSwitchingBoard("");
    }
  };
  const addBoard = async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    try {
      const parsed = parseBoardUrl(String(data.get("url")));
      if (boards.some((b) => b.url === parsed.url))
        throw new Error("这个画板已在灵感册中。");
      if (boards.length >= 100) throw new Error("最多保存 100 个画板。");
      const board = {
        ...parsed,
        name: String(data.get("name")).trim() || parsed.name,
      };
      await selectBoard(board);
      saveBoards([...boards, board]);
      form.reset();
    } catch (err) {
      setBoardError(err.message);
    }
  };
  const removeBoard = (url) => {
    try {
      saveBoards(boards.filter((b) => b.url !== url));
      setBoardNotice("已移除本地链接。");
    } catch (err) {
      setBoardError(err.message);
    }
  };

  return (
    <main
      ref={scrollRef}
      className={`inspiration-shelf notebook-shelf ${selection && !focusClosing ? "has-focus" : ""}`}
      data-scene-paused={!entered || closing || selection ? "true" : undefined}
      data-navigating={!entered || closing ? "true" : undefined}
      inert={closing}
    >
      <header className="shelf-header">
        <div className="shelf-heading-group">
          <button
            className="shelf-back nav-dot"
            type="button"
            onClick={onBack}
            aria-label="返回圆盘"
          />
        </div>
        <div className="shelf-tools">
          <button
            type="button"
            className="shelf-board-trigger"
            aria-haspopup="dialog"
            onClick={(event) => {
              setBoardError("");
              setBoardNotice("");
              boardDialog.open(event);
            }}
          >
            <span className="board-trigger-label">
              <MotionText>{collection.board.name}</MotionText>
            </span>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.25" />
            </svg>
          </button>
        </div>
      </header>
      <section
        ref={gridRef}
        className="shelf-grid"
        aria-label="灵感收藏"
        inert={!entered || closing}
      >
        {collection.projects.map((project) => {
          const animated = isAnimatedGif(project);
          return (
            <button
              type="button"
              className="shelf-item"
              key={project.id}
              data-animated={animated ? "true" : undefined}
              data-project-id={project.id}
              style={{
                "--image-ratio":
                  !animated && project.preview
                    ? project.preview.width / project.preview.height
                    : project.width / project.height || 1,
                "--item-color": project.dominantColor || "#777",
              }}
              aria-label={`聚焦${project.name}`}
              onContextMenu={(e) => e.preventDefault()}
              onClick={(e) => focusImage(e, project)}
            >
              <span className="shelf-liquid-surface">
                <span className="shelf-image">
                  <PinImage project={project} animated={animated} />
                </span>
              </span>
            </button>
          );
        })}
      </section>
      {entered && <ShelfLiquid gridRef={gridRef} />}
      {!collection.projects.length && (
        <p className="shelf-empty">
          <MotionText>这个画板暂时没有可显示的灵感</MotionText>
        </p>
      )}
      <footer className="shelf-footer">
        <a
          href={collection.board.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MotionText>Pinterest</MotionText> <Arrow />
        </a>
      </footer>
      {selection && (
        <FocusExplorer
          key={selection.project.id}
          selection={selection}
          onClosing={() => {
            setFocusClosing(true);
            return returnFocus.current?.isConnected
              ? returnFocus.current.getBoundingClientRect()
              : null;
          }}
          onClose={closeFocus}
          onBranch={(project, origin) => setSelection({ project, origin })}
        />
      )}
      <BoardMenu
        dialogRef={dialogRef}
        dialog={boardDialog}
        className="shelf-boards-dialog"
        boards={boards}
        currentUrl={boardUrl}
        switchingBoard={switchingBoard}
        error={boardError}
        notice={boardNotice}
        onSelect={selectBoard}
        onRemove={removeBoard}
        onAdd={addBoard}
      />
    </main>
  );
}
