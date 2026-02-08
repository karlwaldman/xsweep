import { useEffect, useState } from "react";
import {
  getUserCount,
  getListCount,
  getUnfollowCount,
  clearAllData,
} from "../../../storage/db";
import { exportUsersCSV, exportUsersJSON } from "../../../utils/export";
import { getAllUsers } from "../../../storage/db";

export default function Settings() {
  const [apiKey, setApiKey] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [stats, setStats] = useState({ users: 0, lists: 0, unfollows: 0 });
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const data = await chrome.storage.local.get("xsweep_claude_api_key");
    if (data.xsweep_claude_api_key) setApiKey(data.xsweep_claude_api_key);

    setStats({
      users: await getUserCount(),
      lists: await getListCount(),
      unfollows: await getUnfollowCount(),
    });
  }

  async function saveApiKey() {
    await chrome.storage.local.set({ xsweep_claude_api_key: apiKey });
  }

  async function handleExportCSV() {
    const users = await getAllUsers();
    exportUsersCSV(users);
  }

  async function handleExportJSON() {
    const users = await getAllUsers();
    exportUsersJSON(users);
  }

  async function handleClearData() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    await clearAllData();
    await chrome.storage.local.remove([
      "xsweep_follower_ids",
      "xsweep_following_count",
      "xsweep_follower_count",
      "xsweep_last_scan",
      "xsweep_whitelist",
    ]);
    setConfirmClear(false);
    await loadSettings();
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-sm font-semibold">Settings</h2>

      {/* Claude API Key */}
      <div className="bg-x-card rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-medium">Claude API Key (Pro)</h3>
        <p className="text-xs text-x-text-secondary">
          Required for AI-powered smart lists. Get your API key from{" "}
          <a
            href="https://console.anthropic.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-x-accent hover:underline"
          >
            console.anthropic.com
          </a>
        </p>
        <div className="flex gap-2">
          <input
            type={apiKeyVisible ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
            className="flex-1 bg-x-bg border border-x-border rounded-lg px-3 py-2 text-sm text-x-text placeholder-x-text-secondary focus:border-x-accent focus:outline-none"
          />
          <button
            onClick={() => setApiKeyVisible(!apiKeyVisible)}
            className="px-2 text-xs text-x-text-secondary hover:text-x-text"
          >
            {apiKeyVisible ? "Hide" : "Show"}
          </button>
        </div>
        <button
          onClick={saveApiKey}
          className="px-4 py-1.5 bg-x-accent text-white rounded-full text-xs font-medium hover:bg-x-accent-hover transition-colors"
        >
          Save Key
        </button>
      </div>

      {/* Export */}
      <div className="bg-x-card rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-medium">Export Data</h3>
        <div className="flex gap-2">
          <button
            onClick={handleExportCSV}
            disabled={stats.users === 0}
            className="px-4 py-1.5 bg-x-border text-x-text rounded-full text-xs hover:bg-x-card disabled:opacity-50 transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={handleExportJSON}
            disabled={stats.users === 0}
            className="px-4 py-1.5 bg-x-border text-x-text rounded-full text-xs hover:bg-x-card disabled:opacity-50 transition-colors"
          >
            Export JSON
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="bg-x-card rounded-xl p-4">
        <h3 className="text-sm font-medium mb-2">Storage</h3>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-lg font-bold">
              {stats.users.toLocaleString()}
            </div>
            <div className="text-[10px] text-x-text-secondary">Users</div>
          </div>
          <div>
            <div className="text-lg font-bold">{stats.lists}</div>
            <div className="text-[10px] text-x-text-secondary">Lists</div>
          </div>
          <div>
            <div className="text-lg font-bold">{stats.unfollows}</div>
            <div className="text-[10px] text-x-text-secondary">Unfollowed</div>
          </div>
        </div>
      </div>

      {/* Clear Data */}
      <div className="bg-x-card rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-medium">Clear All Data</h3>
        <p className="text-xs text-x-text-secondary">
          Removes all scanned data, lists, and unfollow history. This cannot be
          undone.
        </p>
        <button
          onClick={handleClearData}
          className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
            confirmClear
              ? "bg-x-red text-white"
              : "bg-x-red/20 text-x-red hover:bg-x-red/30"
          }`}
        >
          {confirmClear ? "Confirm: Clear Everything" : "Clear All Data"}
        </button>
      </div>

      {/* About */}
      <div className="text-center py-4 space-y-1">
        <div className="text-sm font-semibold text-x-accent">XSweep v0.1.0</div>
        <div className="text-xs text-x-text-secondary">
          Clean up your X. Organize who you follow with AI.
        </div>
      </div>
    </div>
  );
}
