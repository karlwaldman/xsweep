# XSweep

**Clean up your X. Organize who you follow with AI.**

XSweep is a privacy-first Chrome extension for managing who you follow on X (Twitter). It runs entirely in your browser — no data ever leaves your machine.

## Features

### Dashboard

Account health score (A–F) with AI-powered coaching tips. See at a glance how healthy your following list is.

### Audit

Browse everyone you follow with orthogonal filters: combine relationship status (mutual, non-mutual), account status (active, inactive, suspended), follower count ranges, and more. Sort by any column.

### Smart Lists

Organize your following into keyword-based or AI-categorized lists. Sync lists directly to X so they show up in your native X sidebar.

### AI Review

Bring your own Claude API key to categorize accounts automatically. XSweep sends account metadata to Anthropic's API — never credentials or cookies.

### Mass Unfollow

Select accounts to unfollow in bulk with a Gmail-style undo pattern — every unfollow has a 4-second undo window before it executes.

### Monetization Intelligence

Track your X monetization eligibility, estimate payouts, and find your best posting times. No other follow-management tool offers this.

## Privacy

XSweep is designed to be privacy-first:

- **All data stays in your browser** — stored in IndexedDB via the extension's background script
- **No backend server** — the extension talks directly to X's API using your existing session
- **BYOK for AI** — you provide your own Claude API key; XSweep never sees or stores it beyond `chrome.storage.local`
- **Open source** — read every line of code yourself

## Install

### From Chrome Web Store

_Coming soon_

### From Source

Requires [Node.js 22+](https://nodejs.org/) and [bun](https://bun.sh/).

```bash
git clone https://github.com/karlwaldman/xsweep.git
cd xsweep
bun install
bun run build
```

Then load the extension in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `.output/chrome-mv3` directory

### Development

```bash
bun run dev          # Start dev server with HMR
bun run test         # Run tests
bun run test:watch   # Run tests in watch mode
```

## AI Setup (Optional)

XSweep's AI features (Review, Smart Lists categorization, Dashboard coaching) require a Claude API key.

1. Get an API key from [console.anthropic.com](https://console.anthropic.com/)
2. Open XSweep → Settings → paste your key
3. That's it — the key is stored locally and sent directly to Anthropic's API

## Tech Stack

- [WXT](https://wxt.dev/) — Chrome extension framework
- [React 19](https://react.dev/) — UI
- [Tailwind CSS](https://tailwindcss.com/) — Styling
- [Dexie](https://dexie.org/) — IndexedDB wrapper
- [Vitest](https://vitest.dev/) — Testing
- TypeScript throughout

## How It Works

XSweep uses X's existing web APIs via your logged-in session. It extracts your session token from the active X tab — the same credentials your browser already uses. No scraping, no third-party auth, no OAuth app.

The extension architecture:

| Component             | Role                                                                        |
| --------------------- | --------------------------------------------------------------------------- |
| **Content script**    | Injected into x.com tabs; extracts auth tokens from the page                |
| **Background script** | Handles API calls, IndexedDB storage, and unfollow operations               |
| **Side panel**        | The main UI — 6 pages (Dashboard, Audit, Lists, Review, Unfollow, Settings) |
| **Popup**             | Quick-launch button that opens the side panel                               |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
