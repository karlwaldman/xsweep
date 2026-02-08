import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    build: {
      rollupOptions: {
        output: {
          // Escape non-ASCII chars so Chrome extension loader doesn't choke
          generatedCode: { arrowFunctions: true },
        },
      },
    },
    esbuild: {
      charset: "ascii",
    },
  }),
  manifest: {
    name: "XSweep - Mass Unfollow & AI Follow Lists for X/Twitter",
    description:
      "Clean up your X. Organize who you follow with AI-powered smart lists.",
    version: "0.1.0",
    permissions: ["sidePanel", "storage", "activeTab", "downloads"],
    host_permissions: ["https://x.com/*", "https://api.anthropic.com/*"],
    side_panel: {
      default_path: "sidepanel.html",
    },
    action: {
      default_title: "XSweep",
      default_popup: "popup.html",
    },
    icons: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    },
  },
});
