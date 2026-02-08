import { useEffect, useState } from "react";
import {
  getAllLists,
  createList,
  deleteList,
  getAllUsers,
  getUsersByListId,
  updateUserListIds,
} from "../../../storage/db";
import { batchCategorizeByKeywords } from "../../../core/categorizer";
import type { SmartList, UserProfile } from "../../../core/types";

const MAX_FREE_LISTS = 3;

interface ListWithUsers extends SmartList {
  users: UserProfile[];
}

export default function Lists() {
  const [lists, setLists] = useState<ListWithUsers[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKeywords, setNewKeywords] = useState("");
  const [newType, setNewType] = useState<"keyword" | "ai">("keyword");
  const [newDescription, setNewDescription] = useState("");
  const [expandedList, setExpandedList] = useState<number | null>(null);
  const [categorizing, setCategorizing] = useState(false);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    loadLists();
    // Load API key from storage
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

  async function handleCreateList() {
    if (!newName.trim()) return;

    const now = new Date().toISOString();
    await createList({
      name: newName.trim(),
      type: newType,
      keywords: newKeywords
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean),
      description: newDescription.trim(),
      createdAt: now,
      updatedAt: now,
    });

    setNewName("");
    setNewKeywords("");
    setNewDescription("");
    setShowCreate(false);

    // If keyword list, run categorization immediately
    if (newType === "keyword") {
      await runKeywordCategorization();
    }

    await loadLists();
  }

  async function runKeywordCategorization() {
    setCategorizing(true);
    const users = await getAllUsers();
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
      alert("Set your Claude API key in Settings first.");
      return;
    }
    setCategorizing(true);
    chrome.runtime.sendMessage({
      type: "CATEGORIZE_AI",
      listId,
      apiKey,
    });

    // Listen for completion
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

  async function handleDeleteList(id: number) {
    await deleteList(id);
    await loadLists();
  }

  const keywordListCount = lists.filter((l) => l.type === "keyword").length;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Smart Lists</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs text-x-accent hover:text-x-accent-hover"
        >
          + New List
        </button>
      </div>

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
                Keyword{" "}
                {keywordListCount >= MAX_FREE_LISTS && "(limit reached)"}
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

          <div className="flex gap-2">
            <button
              onClick={handleCreateList}
              disabled={
                !newName.trim() ||
                (newType === "keyword" && keywordListCount >= MAX_FREE_LISTS)
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
      {lists.length > 0 && (
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
        <div className="text-center py-8 text-x-text-secondary text-sm">
          No lists yet. Create one to categorize your following.
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
                    {list.type === "ai" ? "🤖" : "🏷️"}
                  </span>
                  <span className="text-sm font-medium">{list.name}</span>
                  <span className="text-xs text-x-text-secondary">
                    ({list.users.length})
                  </span>
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
                        <span className="text-xs">@{user.username}</span>
                      </div>
                    ))}
                    {list.users.length > 20 && (
                      <div className="text-xs text-x-text-secondary py-1">
                        ...and {list.users.length - 20} more
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-x-border mt-2">
                    <button
                      onClick={() => handleDeleteList(list.id!)}
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
