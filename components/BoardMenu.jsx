"use client";

import { useId } from "react";

function Arrow() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 15 15 5M5 5h10v10" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

export default function BoardMenu({
  dialogRef,
  dialog,
  className,
  boards,
  currentUrl,
  switchingBoard,
  error,
  notice,
  onSelect,
  onRemove,
  onAdd,
}) {
  const id = useId();

  return (
    <dialog
      ref={dialogRef}
      className={`${className} glass-drawer`}
      aria-label="切换或添加画板"
      data-scene-background="live"
      onCancel={dialog.onCancel}
      onClick={dialog.onBackdropClick}
    >
      <div className="drawer-content">
        <div className="drawer-body">
          <ul className="board-menu-list" aria-label="已保存的画板">
            {boards.map((board) => {
              const active = board.url === currentUrl;
              const loading = board.url === switchingBoard;
              return (
                <li key={board.url}>
                  <button
                    className="board-menu-select"
                    type="button"
                    disabled={active || !!switchingBoard}
                    aria-current={active ? "true" : undefined}
                    aria-busy={loading || undefined}
                    onClick={() =>
                      Promise.resolve(onSelect(board)).catch(() => {})
                    }
                  >
                    <span>{board.name}</span>
                    {loading ? (
                      <span className="board-menu-loading" role="status">
                        载入中
                      </span>
                    ) : active ? (
                      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <path
                          d="m4 10 4 4 8-8"
                          stroke="currentColor"
                          strokeWidth="1.25"
                        />
                      </svg>
                    ) : null}
                  </button>
                  <a
                    className="board-menu-external"
                    href={board.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`在 Pinterest 打开${board.name}`}
                    title="在 Pinterest 打开"
                  >
                    <Arrow />
                  </a>
                  {!board.primary && (
                    <button
                      className="board-menu-remove"
                      type="button"
                      disabled={active || !!switchingBoard}
                      onClick={() => onRemove(board.url)}
                      aria-label={`移除${board.name}`}
                    >
                      移除
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <form className="board-menu-form" onSubmit={onAdd}>
            <label htmlFor={`${id}-url`}>画板链接</label>
            <input
              id={`${id}-url`}
              name="url"
              inputMode="url"
              autoComplete="url"
              placeholder="pinterest.com/用户名/画板名/"
              required
              maxLength={1000}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-error` : undefined}
            />
            <label htmlFor={`${id}-name`}>
              名称 <span>选填</span>
            </label>
            <input
              id={`${id}-name`}
              name="name"
              autoComplete="off"
              placeholder="画板名称"
              maxLength={60}
            />
            <button type="submit" disabled={!!switchingBoard}>
              {switchingBoard ? "正在连接…" : "添加画板"}
              <Arrow />
            </button>
          </form>
          {error && (
            <p id={`${id}-error`} className="board-menu-message" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="board-menu-message" role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
    </dialog>
  );
}
