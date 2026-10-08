import inspiration from "../../public/pinterest/ai-inspiration.json";

// Ring order, not filename order. Art is dealt straight down this list, so
// entry n sits one slot along from n-1 and the column can count in order as the
// carousel turns. Reordering these rows moves the ring, the column and the
// numbering together; nothing else needs touching.
//
// These entries are the latest public pins imported from the default board.
// The manifest preserves each Pin URL and the original image dimensions.
export const PINTEREST_BOARD = inspiration.board;
export const PROJECTS = inspiration.pins;

export const IMAGE_FILES = PROJECTS.map((p) => p.file);
