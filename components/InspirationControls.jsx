"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import MotionText from "./MotionText";
import BoardMenu from "./BoardMenu";
import useLiquidDialog from "./useLiquidDialog";
import {
  getBoards,
  getServerBoards,
  parseBoardUrl,
  saveBoards,
  subscribeBoards,
} from "./pinterest/boards";

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 18 18 6M6 6h12v12" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function InspirationControls({
  ready,
  projects,
  currentIndex,
  ringStart,
  ringCount,
  board,
  switchingBoard,
  syncingBoard,
  onSelectBoard,
  onSyncBoard,
  onSelectProject,
  onExplore,
}) {
  const dialogRef = useRef(null);
  const indexDialogRef = useRef(null);
  const boardDialog = useLiquidDialog(dialogRef);
  const boards = useSyncExternalStore(
    subscribeBoards,
    getBoards,
    getServerBoards,
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [indexQuery, setIndexQuery] = useState("");
  const [indexError, setIndexError] = useState("");

  const indexedProjects = useMemo(() => {
    const query = indexQuery.trim().toLowerCase();
    return projects
      .map((project, index) => ({ project, index }))
      .filter(({ project, index }) => {
        if (!query) return true;
        const number = String(index + 1).padStart(3, "0");
        return `${number} ${project.name} ${project.type} ${project.id}`
          .toLowerCase()
          .includes(query);
      });
  }, [indexQuery, projects]);

  const openIndex = () => {
    setIndexError("");
    setIndexQuery("");
    indexDialogRef.current?.showModal();
    Promise.resolve(onSyncBoard()).catch((err) => {
      setIndexError(err.message || "完整画板同步失败。");
    });
  };

  const addBoard = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const parsed = parseBoardUrl(String(data.get("url")));
      if (boards.some((board) => board.url === parsed.url)) {
        throw new Error("这个画板已经在你的灵感册中了。");
      }
      if (boards.length >= 100) {
        throw new Error("已保存 100 个画板，请先移除不再需要的链接。");
      }
      const name = String(data.get("name")).trim() || parsed.name;
      const nextBoard = { ...parsed, name };
      saveBoards([...boards, nextBoard]);
      await onSelectBoard(nextBoard, boardDialog.close);
      form.reset();
      setError("");
      setNotice(`已添加「${name}」`);
    } catch (err) {
      setError(err.message);
      setNotice("");
    }
  };

  const selectBoard = async (nextBoard) => {
    if (nextBoard.url === board.url) return;
    setError("");
    setNotice("");
    try {
      await onSelectBoard(nextBoard, boardDialog.close);
    } catch (err) {
      setError(err.message);
    }
  };

  const removeBoard = (url) => {
    try {
      saveBoards(boards.filter((board) => board.url !== url));
      setError("");
      setNotice("已移除本地链接，Pinterest 中的画板保持不变。");
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <header className="notebook-header">
        <button
          type="button"
          className="zoom-button nav-dot"
          onClick={onExplore || openIndex}
          disabled={!ready}
          aria-label="打开灵感墙"
          title="打开灵感墙"
        />
        <div className="notebook-actions">
          <button
            type="button"
            className="boards-trigger"
            aria-haspopup="dialog"
            aria-label={`切换画板，当前为${board.name}`}
            onClick={(event) => {
              setError("");
              setNotice("");
              boardDialog.open(event);
            }}
          >
            <span className="board-trigger-label">
              <MotionText>{board.name}</MotionText>
            </span>
            <Chevron />
          </button>
        </div>
      </header>

      <dialog
        ref={indexDialogRef}
        className="inspiration-index-dialog"
        aria-labelledby="index-title"
      >
        <header className="index-header">
          <div>
            <span className="eyebrow">
              <MotionText>{`CONTACT SHEET / ${board.name}`}</MotionText>
            </span>
            <h2 id="index-title">
              <MotionText>全部灵感</MotionText>
            </h2>
          </div>
          <button
            className="close-dialog"
            type="button"
            aria-label="关闭全部灵感"
            onClick={() => indexDialogRef.current?.close()}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="m6 6 12 12M18 6 6 18"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </button>
        </header>

        <div className="index-toolbar">
          <label className="index-search">
            <span className="sr-only">搜索灵感</span>
            <input
              type="search"
              value={indexQuery}
              onChange={(event) => setIndexQuery(event.target.value)}
              placeholder="搜索编号或名称"
              autoComplete="off"
            />
          </label>
          <div className="index-status" aria-live="polite">
            <span>
              <MotionText>{`当前环 ${String(ringStart + 1).padStart(3, "0")}—${String(ringStart + ringCount).padStart(3, "0")}`}</MotionText>
            </span>
            <span>
              <MotionText>
                {syncingBoard
                  ? "正在同步完整画板…"
                  : `已载入 ${projects.length} / ${board.totalPins || projects.length}`}
              </MotionText>
            </span>
          </div>
        </div>

        {indexError && (
          <p className="index-error" role="alert">
            <MotionText>{indexError}</MotionText>
          </p>
        )}

        {indexedProjects.length ? (
          <div className="inspiration-grid" aria-label="全部灵感缩略图">
            {indexedProjects.map(({ project, index }) => {
              const active = index === currentIndex;
              const inRing =
                index >= ringStart && index < ringStart + ringCount;
              const src = project.thumb ?? project.file;
              return (
                <button
                  type="button"
                  className="inspiration-tile"
                  key={project.id ?? project.file}
                  aria-current={active ? "true" : undefined}
                  data-in-ring={inRing ? "true" : "false"}
                  onClick={() => {
                    indexDialogRef.current?.close();
                    onSelectProject(index);
                  }}
                >
                  <span
                    className="inspiration-image"
                    style={{
                      backgroundColor: project.dominantColor || "#ececec",
                    }}
                  >
                    <Image
                      src={src.startsWith("/") ? src : `/${src}`}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 1200px) 25vw, 16vw"
                      unoptimized
                      loading="lazy"
                    />
                  </span>
                  <span className="inspiration-meta">
                    <span>
                      <MotionText>
                        {String(index + 1).padStart(3, "0")}
                      </MotionText>
                    </span>
                    <span>
                      <MotionText>{project.name}</MotionText>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="index-empty">
            <MotionText>没有匹配的灵感。</MotionText>
          </p>
        )}

        <footer className="index-footer">
          <span>
            <MotionText>
              {projects.length < board.totalPins
                ? "公开页面暂未返回全部收藏"
                : `共 ${projects.length} 条`}
            </MotionText>
          </span>
          <a href={board.url} target="_blank" rel="noopener noreferrer">
            <MotionText>前往完整 Pinterest 画板</MotionText>
            <Arrow />
          </a>
        </footer>
      </dialog>

      <BoardMenu
        dialogRef={dialogRef}
        dialog={boardDialog}
        className="boards-dialog"
        boards={boards}
        currentUrl={board.url}
        switchingBoard={switchingBoard}
        error={error}
        notice={notice}
        onSelect={selectBoard}
        onRemove={removeBoard}
        onAdd={addBoard}
      />
    </>
  );
}
