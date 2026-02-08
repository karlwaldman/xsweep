# Contributing to XSweep

Thanks for your interest in contributing! XSweep is a Chrome extension built with WXT, React, and TypeScript.

## Development Setup

### Prerequisites

- [Node.js 22+](https://nodejs.org/)
- [bun](https://bun.sh/)

### Getting Started

```bash
git clone https://github.com/karlwaldman/xsweep.git
cd xsweep
bun install
bun run dev
```

Load the extension in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `.output/chrome-mv3`

### Running Tests

```bash
bun run test           # Run once
bun run test:watch     # Watch mode
```

## Project Structure

```
src/
  core/           # Business logic (scanner, unfollower, categorizer, etc.)
  entrypoints/    # Extension entry points
    background.ts # Service worker — API calls, DB writes, unfollow queue
    content.ts    # Content script — auth token extraction from x.com
    popup/        # Extension popup (opens side panel)
    sidepanel/    # Main UI
      pages/      # Dashboard, Audit, Lists, Review, Unfollow, Settings
  storage/        # IndexedDB schema (Dexie)
  utils/          # Helpers (export, formatting, rate limiting)
tests/
  core/           # Unit tests for core logic
  helpers/        # Test fixtures
  storage/        # DB tests
  utils/          # Utility tests
```

## Guidelines

- **TypeScript strict mode** — no `any` unless absolutely necessary
- **Tests required** for new core logic
- **Keep it local** — XSweep stores everything in the browser. Don't add external services.
- **Privacy first** — never send user data to third parties (except the user's own Claude API key to Anthropic, which is opt-in)

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Add tests for new functionality
3. Make sure `bun run test` passes
4. Make sure `bun run build` succeeds
5. Open a PR with a clear description of what changed and why

## Reporting Issues

Use the [issue templates](.github/ISSUE_TEMPLATE/) for bug reports and feature requests.

## Architecture Notes

- **Content script** runs on x.com pages — it can access the DOM but NOT IndexedDB (host-page-scoped). It sends auth tokens to the background script via `chrome.runtime.sendMessage`.
- **Background script** owns all IndexedDB writes and API calls. UI components communicate with it via messages.
- **Side panel** is the main UI — it reads from IndexedDB directly (shared origin with background) and sends commands via messages.

This architecture exists because content script IndexedDB is scoped to the host page (x.com), not the extension.
