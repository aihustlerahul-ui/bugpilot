# Media Setup Page Design Spec

**Date:** 2026-07-02
**Status:** Approved

---

## Background

Live testing confirmed the root cause of the "clicking mic/camera chip does nothing" problem: Chrome's Side Panel API does not reliably show the native `getUserMedia` permission prompt, even though the exact same extension origin works fine when opened as a normal tab. The current fix (see `2026-07-02` commits `be0ba02`/`a00b472`) points the user at the raw `sidepanel.html` URL as a tab — functional, but visibly a developer workaround, not something a non-technical end user should have to parse.

This spec replaces that raw-URL link with a dedicated, polished setup page.

---

## Trigger

Lazy / on-demand only — no proactive prompt after login. The setup tab opens only when the user clicks "Record Video" or a status chip and the relevant permission (`captureAudioEnabled` and/or `captureWebcamEnabled`, whichever is on) is not yet granted, exactly the same trigger point as today. `showSidePanelPermissionHelp()`'s link target changes from `sidepanel.html` to the new `setup.html`; no other trigger logic changes.

---

## New file: `extension/setup.html` + `extension/setup.js`

A minimal, branded page (reuses the extension's existing CSS custom properties — `--brand`, `--green`, `--red`, `--bg`, `--surface`, `--border`, `--text-hi`, `--text-mid`, `--text-lo` — copied from `sidepanel.html`'s `:root` block), added to `web_accessible_resources` in `manifest.json`. Opened via `chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') })` — a real tab, where `getUserMedia` prompts work normally (only the side panel surface is broken).

### Layout

Two cards side by side (`display: flex; gap: 16px`), one per capability. Only the card(s) for the capability actually enabled in settings render — if only `captureAudioEnabled` is on, only the microphone card shows; both show if both are on.

Each card contains, top to bottom:
1. **Header row**: icon + label (left), status badge (right) — "Not started" (grey), "Ready" (green), or "Blocked" (red, mirroring the side panel's denied-state copy).
2. **Test area**: a dashed-border placeholder box before testing; after a successful grant, this becomes either a live level-meter (mic) or a live `<video>` preview (camera), matching the visual language of the equivalents already built in the side panel (Task 5 and Task 6 of the prior `media-permission-status` plan).
3. **Confirmation strip**: small green/informational box confirming what the user should observe ("Bars moving means it's picking up sound" / "You can see yourself above — camera is working").
4. **Device selector**: a `<label>` + `<select>` populated from `navigator.mediaDevices.enumerateDevices()`, filtered to `audioinput` (mic card) or `videoinput` (camera card) kinds. Defaults to the first/system-default device. Changing the selection stops the current stream and re-requests `getUserMedia` with `{ deviceId: { exact: selectedId } }`, refreshing the live meter/preview against the newly selected device.
5. **Action button**: "Test microphone" / "Test camera" before first grant; relabels to "Retest microphone" / "Retest camera" afterward (re-running the test against the currently selected device, useful after switching devices via the selector).

### Completion state

Once every card present on the page reaches "Ready", a full-width green banner appears below the cards: "All set! Closing this tab automatically — head back to the side panel." The tab calls `window.close()` after a ~1.5s delay.

### Side panel integration

No polling needed — the side panel's existing `navigator.permissions.query(...).onchange` listeners (already built for the mic/camera status chips) fire automatically once the permission decision changes, which happens the moment `setup.html` successfully calls `getUserMedia`. The chip flips to green with no manual refresh and no message-passing between the setup tab and the side panel required.

---

## Manifest changes

`extension/manifest.json`: add `"setup.html"` to the `web_accessible_resources.resources` array (alongside the existing `content-styles.css`, `rrweb.min.js`, `replay-recorder.js`).

---

## Out of Scope (this iteration)

- Proactive/first-login trigger — deliberately rejected in favor of lazy/on-demand (see Trigger section).
- Persisting the user's chosen device across sessions — each visit to the setup page defaults to system default; device selection here only affects the live test, not any stored preference used elsewhere in the extension (the actual recording code already uses whatever device the browser considers default/active at record time).
- Testing audio *output* (speakers) — mic input and camera video only, matching what the recording feature actually needs.
