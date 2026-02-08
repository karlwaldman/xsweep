import { useEffect, useState } from "react";
import { getUserCount } from "../../storage/db";

export default function App() {
  const [userCount, setUserCount] = useState(0);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [onXcom, setOnXcom] = useState(false);

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    setUserCount(await getUserCount());

    const data = await chrome.storage.local.get("xsweep_last_scan");
    setLastScan(data.xsweep_last_scan || null);

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    setOnXcom(
      tab?.url?.includes("x.com") || tab?.url?.includes("twitter.com") || false,
    );
  }

  async function openSidePanel() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
    window.close();
  }

  async function startScan() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
      chrome.tabs.sendMessage(tab.id, { type: "START_SCAN" });
    }
    window.close();
  }

  return (
    <div className="w-72 bg-x-bg text-x-text p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold text-x-accent">XSweep</span>
      </div>

      {!onXcom && (
        <div className="bg-x-yellow/10 text-x-yellow text-xs rounded-lg p-2.5">
          Navigate to x.com to use XSweep.
        </div>
      )}

      {userCount > 0 && (
        <div className="bg-x-card rounded-lg p-3">
          <div className="text-sm font-medium">
            {userCount.toLocaleString()} users scanned
          </div>
          {lastScan && (
            <div className="text-xs text-x-text-secondary">
              Last scan: {new Date(lastScan).toLocaleDateString()}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {userCount === 0 && onXcom && (
          <button
            onClick={startScan}
            className="w-full px-4 py-2 bg-x-accent text-white rounded-full text-sm font-medium hover:bg-x-accent-hover transition-colors"
          >
            Scan My Following
          </button>
        )}

        <button
          onClick={openSidePanel}
          className="w-full px-4 py-2 bg-x-card text-x-text rounded-full text-sm font-medium hover:bg-x-border transition-colors"
        >
          Open Dashboard
        </button>
      </div>

      <div className="text-center text-[10px] text-x-text-secondary">
        v0.1.0
      </div>
    </div>
  );
}
