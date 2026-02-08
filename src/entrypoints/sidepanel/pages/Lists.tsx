import { useEffect, useState } from "react";
import {
  getAllLists,
  createList,
  deleteList,
  getAllUsers,
  getUsersByListId,
  updateUserListIds,
  getListByXListId,
  upsertUsers,
} from "../../../storage/db";
import { batchCategorizeByKeywords } from "../../../core/categorizer";
import type { SmartList, UserProfile } from "../../../core/types";
import type { ShowToastFn } from "../App";

interface XListPreview {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  mode: "public" | "private";
  alreadyImported: boolean;
}

interface ListWithUsers extends SmartList {
  users: UserProfile[];
}

interface Props {
  showToast: ShowToastFn;
}

export default function Lists({ showToast }: Props) {
  const [lists, setLists] = useState<ListWithUsers[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKeywords, setNewKeywords] = useState("");
  const [newType, setNewType] = useState<"keyword" | "ai">("keyword");
  const [newDescription, setNewDescription] = useState("");
  const [syncToX, setSyncToX] = useState(false);
  const [expandedList, setExpandedList] = useState<number | null>(null);
  const [categorizing, setCategorizing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [xLists, setXLists] = useState<XListPreview[]>([]);
  const [importing, setImporting] = useState<string | null>(null);
  const [loadingXLists, setLoadingXLists] = useState(false);

  useEffect(() => {
    loadLists();
    chrome.storage.local.get("xsweep_claude_api_key").then((data) => {
      if (data.xsweep_claude_api_key) setApiKey(data.xsweep_claude_api_key);
    });
  }, []);

  async function loadLists() {
    const allLists = await getAllLists();
    const listsWithUsers: ListWithUsers[] = [];
    for (const list of allLists) {
      if (list.id !== undefined) {
        const users = await getUsersByListId(list.id);
        listsWithUsers.push({ ...list, users });
      }
    }
    setLists(listsWithUsers);
  }

  // ---- Import from X ----

  async function loadXLists() {
    setLoadingXLists(true);
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.url?.includes("x.com") || !tab?.id) {
        showToast("Navigate to x.com first");
        setLoadingXLists(false);
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "FETCH_X_LISTS",
      });

      if (!response?.success) {
        showToast(response?.error || "Failed to fetch lists");
        setLoadingXLists(false);
        return;
      }

      // Check which are already imported
      const previews: XListPreview[] = [];
      for (const xl of response.lists) {
        const existing = await getListByXListId(xl.id);
        previews.push({ ...xl, alreadyImported: !!existing });
      }
      setXLists(previews);
      setShowImport(true);
    } catch {
      showToast("Failed to connect. Make sure you're on x.com.");
    }
    setLoadingXLists(false);
  }

  async function handleImportList(xList: XListPreview) {
    setImporting(xList.id);
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) {
        showToast("Navigate to x.com first");
        setImporting(null);
        return;
      }

      // Fetch members
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "FETCH_X_LIST_MEMBERS",
        listId: xList.id,
      });

      if (!response?.success) {
        showToast(response?.error || "Failed to fetch members");
        setImporting(null);
        return;
      }

      const members = response.members || [];

      // Create smart list linked to X list
      const now = new Date().toISOString();
      const newListId = await createList({
        name: xList.name,
        type: "imported",
        keywords: [],
        description: xList.description,
        createdAt: now,
        updatedAt: now,
        xListId: xList.id,
      });

      // Upsert member profiles into DB and assign to list
      const allUsers = await getAllUsers();
      const existingUserIds = new Set(allUsers.map((u) => u.userId));

      const newUsers: UserProfile[] = [];
      for (const m of members) {
        if (existingUserIds.has(m.userId)) {
          // User already in DB — just add list assignment
          const user = allUsers.find((u) => u.userId === m.userId);
          if (user) {
            const updatedIds = [...new Set([...user.listIds, newListId])];
            await updateUserListIds(m.userId, updatedIds);
          }
        } else {
          // New user — create minimal profile
          newUsers.push({
            userId: m.userId,
            username: m.username,
            displayName: m.displayName,
            bio: "",
            followerCount: 0,
            followingCount: 0,
            tweetCount: 0,
            lastTweetDate: null,
            daysSinceLastTweet: null,
            status: "active",
            isFollower: false,
            isMutual: false,
            isVerified: false,
            listIds: [newListId],
            scannedAt: now,
            profileImageUrl: m.profileImageUrl,
          });
        }
      }

      if (newUsers.length > 0) {
        await upsertUsers(newUsers);
      }

      // Update import preview
      setXLists((prev) =>
        prev.map((xl) =>
          xl.id === xList.id ? { ...xl, alreadyImported: true } : xl,
        ),
      );

      await loadLists();
      showToast(`Imported "${xList.name}" (${members.length} members)`);
    } catch (e) {
      showToast(`Import failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
    setImporting(null);
  }

  // ---- Create ----

  async function handleCreateList() {
    if (!newName.trim()) return;

    const name = newName.trim();
    const desc = newDescription.trim();
    let xListId: string | undefined;

    // Optionally create on X too
    if (syncToX) {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab?.url?.includes("x.com") && tab?.id) {
          const response = await chrome.tabs.sendMessage(tab.id, {
            type: "CREATE_X_LIST",
            name,
            description: desc,
            mode: "private",
          });
          if (response?.success && response.list) {
            xListId = response.list.id;
          } else {
            showToast("Created locally (X sync failed)");
          }
        }
      } catch {
        showToast("Created locally (not on x.com)");
      }
    }

    const now = new Date().toISOString();
    await createList({
      name,
      type: newType,
      keywords: newKeywords
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean),
      description: desc,
      createdAt: now,
      updatedAt: now,
      xListId,
    });

    setNewName("");
    setNewKeywords("");
    setNewDescription("");
    setSyncToX(false);
    setShowCreate(false);

    if (newType === "keyword") {
      await runKeywordCategorization();
    }

    await loadLists();
    showToast(
      xListId ? `Created "${name}" (synced to X)` : `Created "${name}"`,
    );
  }

  // ---- Categorization ----

  async function runKeywordCategorization() {
    const users = await getAllUsers();
    if (users.length === 0) {
      showToast("No scanned users. Run a scan from Dashboard first.");
      return;
    }

    setCategorizing(true);
    const allLists = await getAllLists();
    const keywordLists = allLists.filter((l) => l.type === "keyword");

    const mapping = batchCategorizeByKeywords(users, keywordLists);

    for (const [userId, listIds] of mapping) {
      const user = users.find((u) => u.userId === userId);
      if (user) {
        const newListIds = [...new Set([...user.listIds, ...listIds])];
        await updateUserListIds(userId, newListIds);
      }
    }

    setCategorizing(false);
    await loadLists();
  }

  async function handleRunAI(listId: number) {
    if (!apiKey) {
      showToast("Set your Claude API key in Settings first.");
      return;
    }
    setCategorizing(true);
    chrome.runtime.sendMessage({
      type: "CATEGORIZE_AI",
      listId,
      apiKey,
    });

    const listener = (message: { type: string; listId: number }) => {
      if (
        message.type === "CATEGORIZE_AI_COMPLETE" &&
        message.listId === listId
      ) {
        setCategorizing(false);
        loadLists();
        chrome.runtime.onMessage.removeListener(listener);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  }

  async function handleDeleteList(id: number, name: string) {
    await deleteList(id);
    await loadLists();
    showToast(`Deleted list "${name}"`);
  }

  const keywordListCount = lists.filter((l) => l.type === "keyword").length;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Smart Lists</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={loadXLists}
            disabled={loadingXLists}
            className="text-xs text-x-accent hover:text-x-accent-hover disabled:opacity-50"
          >
            {loadingXLists ? "Loading..." : "Import from X"}
          </button>
          <button
            onClick={() => {
              setShowCreate(!showCreate);
              setShowImport(false);
            }}
            className="text-xs text-x-accent hover:text-x-accent-hover"
          >
            + New List
          </button>
        </div>
      </div>

      {/* Import from X */}
      {showImport && (
        <div className="bg-x-card rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Your X Lists</h3>
            <button
              onClick={() => setShowImport(false)}
              className="text-xs text-x-text-secondary hover:text-x-text"
            >
              Close
            </button>
          </div>
          {xLists.length === 0 ? (
            <div className="text-xs text-x-text-secondary text-center py-4">
              No lists found on your X account.
            </div>
          ) : (
            <div className="space-y-2">
              {xLists.map((xl) => (
                <div
                  key={xl.id}
                  className="flex items-center justify-between py-2 border-b border-x-border last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{xl.name}</span>
                      <span className="text-[10px] text-x-text-secondary">
                        {xl.memberCount} members
                      </span>
                      {xl.mode === "private" && (
                        <span className="text-[10px] bg-x-border px-1 rounded">
                          private
                        </span>
                      )}
                    </div>
                    {xl.description && (
                      <div className="text-[10px] text-x-text-secondary truncate">
                        {xl.description}
                      </div>
                    )}
                  </div>
                  {xl.alreadyImported ? (
                    <span className="text-[10px] text-x-green px-2">
                      Imported
                    </span>
                  ) : (
                    <button
                      onClick={() => handleImportList(xl)}
                      disabled={importing === xl.id}
                      className="text-xs text-x-accent hover:text-x-accent-hover disabled:opacity-50 px-2"
                    >
                      {importing === xl.id ? "Importing..." : "Import"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create List Form */}
      {showCreate && (
        <div className="bg-x-card rounded-xl p-4 space-y-3">
          <div>
            <label className="text-xs text-x-text-secondary block mb-1">
              Type
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setNewType("keyword")}
                className={`px-3 py-1 rounded-full text-xs ${
                  newType === "keyword"
                    ? "bg-x-accent text-white"
                    : "bg-x-border text-x-text-secondary"
                }`}
              >
                Keyword {keywordListCount >= 3 && "(limit reached)"}
              </button>
              <button
                onClick={() => setNewType("ai")}
                className={`px-3 py-1 rounded-full text-xs ${
                  newType === "ai"
                    ? "bg-x-accent text-white"
                    : "bg-x-border text-x-text-secondary"
                }`}
              >
                AI (Pro)
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-x-text-secondary block mb-1">
              Name
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g., AI & Tech"
              className="w-full bg-x-bg border border-x-border rounded-lg px-3 py-2 text-sm text-x-text placeholder-x-text-secondary focus:border-x-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs text-x-text-secondary block mb-1">
              Description
            </label>
            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What kind of accounts belong here?"
              className="w-full bg-x-bg border border-x-border rounded-lg px-3 py-2 text-sm text-x-text placeholder-x-text-secondary focus:border-x-accent focus:outline-none"
            />
          </div>

          {newType === "keyword" && (
            <div>
              <label className="text-xs text-x-text-secondary block mb-1">
                Keywords (comma-separated)
              </label>
              <input
                type="text"
                value={newKeywords}
                onChange={(e) => setNewKeywords(e.target.value)}
                placeholder="ai, machine learning, llm, gpt"
                className="w-full bg-x-bg border border-x-border rounded-lg px-3 py-2 text-sm text-x-text placeholder-x-text-secondary focus:border-x-accent focus:outline-none"
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-x-text-secondary">
            <input
              type="checkbox"
              checked={syncToX}
              onChange={(e) => setSyncToX(e.target.checked)}
              className="accent-x-accent"
            />
            Also create as X list (private)
          </label>

          <div className="flex gap-2">
            <button
              onClick={handleCreateList}
              disabled={
                !newName.trim() ||
                (newType === "keyword" && keywordListCount >= 3)
              }
              className="px-4 py-2 bg-x-accent text-white rounded-full text-sm font-medium hover:bg-x-accent-hover disabled:opacity-50 transition-colors"
            >
              Create List
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 bg-x-border text-x-text rounded-full text-sm hover:bg-x-card transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Re-categorize button */}
      {lists.some((l) => l.type === "keyword") && (
        <button
          onClick={runKeywordCategorization}
          disabled={categorizing}
          className="w-full px-4 py-2 bg-x-card text-x-text-secondary rounded-lg text-xs hover:bg-x-border disabled:opacity-50 transition-colors"
        >
          {categorizing ? "Categorizing..." : "Re-run keyword categorization"}
        </button>
      )}

      {/* List display */}
      {lists.length === 0 ? (
        <div className="text-center py-8 text-x-text-secondary text-sm space-y-2">
          <div>No lists yet.</div>
          <div className="text-xs">
            Import your X lists or create a new one to organize your following.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {lists.map((list) => (
            <div key={list.id} className="bg-x-card rounded-xl overflow-hidden">
              <button
                onClick={() =>
                  setExpandedList(expandedList === list.id ? null : list.id!)
                }
                className="w-full flex items-center justify-between p-3 hover:bg-x-border/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">
                    {list.type === "ai"
                      ? "🤖"
                      : list.type === "imported"
                        ? "📥"
                        : "🏷️"}
                  </span>
                  <span className="text-sm font-medium">{list.name}</span>
                  <span className="text-xs text-x-text-secondary">
                    ({list.users.length})
                  </span>
                  {list.xListId && (
                    <span className="text-[10px] bg-x-accent/10 text-x-accent px-1 rounded">
                      synced
                    </span>
                  )}
                </div>
                <span className="text-xs text-x-text-secondary">
                  {expandedList === list.id ? "▲" : "▼"}
                </span>
              </button>

              {expandedList === list.id && (
                <div className="border-t border-x-border px-3 pb-3">
                  {list.type === "keyword" && list.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1 py-2">
                      {list.keywords.map((k) => (
                        <span
                          key={k}
                          className="text-[10px] bg-x-border px-1.5 py-0.5 rounded"
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  )}

                  {list.type === "ai" && (
                    <div className="py-2">
                      <button
                        onClick={() => handleRunAI(list.id!)}
                        disabled={categorizing}
                        className="text-xs text-x-accent hover:text-x-accent-hover disabled:opacity-50"
                      >
                        {categorizing
                          ? "Running AI..."
                          : "Run AI categorization"}
                      </button>
                    </div>
                  )}

                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {list.users.slice(0, 20).map((user) => (
                      <div
                        key={user.userId}
                        className="flex items-center gap-2 py-1"
                      >
                        {user.profileImageUrl ? (
                          <img
                            src={user.profileImageUrl}
                            alt=""
                            className="w-5 h-5 rounded-full"
                          />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-x-border" />
                        )}
                        <a
                          href={`https://x.com/${user.username}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-x-accent hover:underline"
                        >
                          @{user.username}
                        </a>
                      </div>
                    ))}
                    {list.users.length > 20 && (
                      <div className="text-xs text-x-text-secondary py-1">
                        ...and {list.users.length - 20} more
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-x-border mt-2">
                    {list.xListId && (
                      <a
                        href={`https://x.com/i/lists/${list.xListId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-x-accent hover:underline"
                      >
                        View on X
                      </a>
                    )}
                    <button
                      onClick={() => handleDeleteList(list.id!, list.name)}
                      className="text-xs text-x-red hover:text-red-400"
                    >
                      Delete list
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
