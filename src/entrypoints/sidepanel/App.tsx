import { useState } from "react";
import Dashboard from "./pages/Dashboard";
import Audit from "./pages/Audit";
import Lists from "./pages/Lists";
import Unfollow from "./pages/Unfollow";
import Settings from "./pages/Settings";

type Page = "dashboard" | "audit" | "lists" | "unfollow" | "settings";

const navItems: Array<{ id: Page; label: string; icon: string }> = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "audit", label: "Audit", icon: "🔍" },
  { id: "lists", label: "Lists", icon: "📋" },
  { id: "unfollow", label: "Unfollow", icon: "🧹" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");

  return (
    <div className="flex flex-col h-screen bg-x-bg text-x-text">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-x-border">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-x-accent">XSweep</span>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        {page === "dashboard" && <Dashboard />}
        {page === "audit" && <Audit />}
        {page === "lists" && <Lists />}
        {page === "unfollow" && <Unfollow />}
        {page === "settings" && <Settings />}
      </main>

      {/* Bottom Nav */}
      <nav className="flex border-t border-x-border bg-x-bg">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors ${
              page === item.id
                ? "text-x-accent"
                : "text-x-text-secondary hover:text-x-text"
            }`}
          >
            <span className="text-base">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
