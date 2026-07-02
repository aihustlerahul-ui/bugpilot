# Draggable Webcam Overlay Design Spec

**Date:** 2026-07-02
**Status:** Approved

---

## Background

`VideoPlayer.tsx` (see `2026-07-02-video-player-controls-design.md`) renders the webcam recording as a small circle fixed to the bottom-right corner of the player. This spec makes that circle draggable so the user can reposition it if it happens to cover something relevant in the underlying screen recording.

---

## Interaction

The webcam circle becomes draggable via pointer events (`pointerdown`/`pointermove`/`pointerup`). While dragging, it follows the cursor freely within the player's bounds. On release, it snaps to whichever of the 4 corners (top-left, top-right, bottom-left, bottom-right) is nearest to the release position — computed by comparing distance from the release point to each of the four corner coordinates of the player's bounding box.

Corners map to the same Tailwind absolute-positioning classes already used for the existing fixed bottom-right placement (`absolute bottom-3 right-3`), just switching which two edge utilities apply per corner:
- top-left → `top-3 left-3`
- top-right → `top-3 right-3`
- bottom-left → `bottom-3 left-3`
- bottom-right → `bottom-3 right-3` (existing default)

---

## Persistence

The chosen corner is saved to `localStorage` under a single key, `qa-video-webcam-corner`, storing one of the four corner string values. This is one global preference shared across every video viewed in this browser — not scoped per-issue or per-video. On mount, `VideoPlayer` reads this key (defaulting to `bottom-right` if unset or invalid) and applies it before any drag interaction occurs.

---

## Fullscreen

The same drag/snap logic applies identically in both the inline and fullscreen layouts, since corner position is computed relative to the player's own bounding box (via `getBoundingClientRect()` on the wrapper element) in both cases — no fullscreen-specific branching needed.

---

## Implementation Approach

Added directly inside `VideoPlayer.tsx` (no new file) since this is a small, tightly-coupled addition to a component that doesn't yet have a separate "webcam overlay" concern elsewhere in the codebase:

- New state: `corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'` (initialized from `localStorage`, falling back to `'bottom-right'`), `dragging: boolean`, `dragPosition: { x: number; y: number } | null` (pixel offset within the player while actively dragging, `null` when not dragging — the circle renders at its snapped `corner` position when this is `null`, and at the live `dragPosition` while dragging).
- `pointerdown` on the webcam `<video>` element starts the drag: captures the pointer (`setPointerCapture`), sets `dragging = true`.
- `pointermove` (attached to the wrapper while dragging) updates `dragPosition` to track the cursor, clamped so the circle never fully leaves the player bounds.
- `pointerup` computes the nearest corner from the release position, sets `corner` to that value, sets `dragging = false` and `dragPosition = null` (circle then renders via its corner's CSS classes), and writes the new corner to `localStorage`.

No visual "snap zone" highlighting or resize handle — out of scope per this iteration (confirmed during brainstorming).

---

## Out of Scope (this iteration)

- Visible snap-zone indicators while dragging.
- Resizing the webcam circle's diameter (fixed at the existing 120px).
- Per-issue or per-video position memory — the saved corner is one global preference for the browser.
