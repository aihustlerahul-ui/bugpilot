# Enhanced Video Player Controls Design Spec

**Date:** 2026-07-02
**Status:** Approved

---

## Background

The issue detail page's "Screen Recording" section currently renders a native `<video controls>` element with a synced webcam overlay (`onPlay`/`onPause`/`onSeeked` handlers doing `querySelector('video[data-webcam]')` on the DOM sibling). Native browser controls already provide play/pause, a seek bar, volume, and — in Chrome — fullscreen and playback speed via a hidden menu. The problem: native fullscreen only fullscreens the `<video>` element itself, so the webcam overlay (an absolutely-positioned sibling) would disappear while fullscreen, since fullscreen swaps out the video element's own rendering surface, not its DOM parent or siblings.

This spec replaces the native controls with a custom control bar and a CSS-based fullscreen mode (not the native Fullscreen API), so the webcam overlay stays visible throughout.

---

## New Component: `platform/components/VideoPlayer.tsx`

Extracts the current inline video block into its own component, following the same visual/interaction conventions already established by `platform/components/ReplayPlayer.tsx` (icon style, spacing, control bar layout) for consistency across the two player types in this codebase.

**Props:**
```typescript
interface VideoPlayerProps {
  videoUrl: string
  webcamUrl?: string | null
  issueTitle?: string
}
```

---

## Controls

A custom control bar replaces the native `controls` attribute:

- **Play/pause button** — reuses `ReplayPlayer`'s `IconPlay`/`IconPause` components (copied into this new file, not imported cross-component, matching how `ReplayPlayer` itself defines its icons locally at the top of the file).
- **Seek bar** — an `<input type="range">` styled to match the app's design tokens, with a hover-preview tooltip showing the timestamp under the cursor position (computed from `video.duration * (hoverX / barWidth)`).
- **Current time / duration** — `0:42 / 3:15` format, updated on `timeupdate`.
- **Volume control** — mute toggle icon + a small volume slider, following the same interaction pattern as the seek bar.
- **Playback speed** — reuses `ReplayPlayer`'s existing `SPEEDS = [0.5, 1, 1.5, 2, 4]` array and dropdown-button pattern for visual consistency between the two players.
- **Fullscreen toggle** — reuses `ReplayPlayer`'s `IconFullscreen`/`IconExitFullscreen` icons.

---

## Webcam Sync

The existing sync logic (mirror play/pause state and seek position onto the webcam video) moves from DOM `querySelector` calls into direct method calls against a `webcamRef: RefObject<HTMLVideoElement>` owned by the same component — same behavior as today, but driven by the component's own play/pause/seek handlers instead of native `<video>` event callbacks reading `e.currentTarget.parentElement`.

---

## Fullscreen Behavior

Matches `ReplayPlayer.tsx`'s existing pattern exactly: an `isFullscreen` boolean state toggles the container between its normal inline layout and a `fixed inset-0 z-50` full-viewport overlay via conditional class names — not the browser's native `element.requestFullscreen()` API. Because this is pure CSS/layout, nothing leaves the DOM tree, so the webcam overlay circle stays rendered and visible in its corner throughout. Escape key and a visible exit-fullscreen button both close it, mirroring `ReplayPlayer`'s existing keyboard handling.

---

## Integration

`platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx`'s "Screen Recording" block (the `{issue.videoUrl && (...)}` section) is replaced with:

```tsx
{issue.videoUrl && (
  <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between px-1">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Screen Recording</h2>
    </div>
    <VideoPlayer videoUrl={issue.videoUrl} webcamUrl={issue.webcamUrl} issueTitle={issue.title ?? undefined} />
  </div>
)}
```

---

## Out of Scope (this iteration)

- Download button — considered during brainstorming, explicitly not requested (user chose the "standard set" without download).
- Picture-in-picture browser API integration — native browser controls exposed this in some browsers, but it's not part of the requested "standard set."
- Keyboard shortcuts beyond Escape-to-exit-fullscreen (matching `ReplayPlayer`'s existing scope) — no additional shortcut scheme (space to play/pause, arrow keys to seek, etc.) requested.
