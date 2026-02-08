import {
  useState,
  useEffect,
  useCallback,
  Component,
  type ReactNode,
} from "react";
import Dashboard from "./pages/Dashboard";
import Audit from "./pages/Audit";
import Lists from "./pages/Lists";
import Review from "./pages/Review";
import Unfollow from "./pages/Unfollow";
import Settings from "./pages/Settings";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-x-bg text-x-text p-6 text-center">
          <span className="text-3xl mb-3">Something went wrong</span>
          <p className="text-sm text-x-text-secondary mb-4">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="px-4 py-2 bg-x-accent text-white rounded-full text-sm font-medium hover:bg-x-accent-hover"
          >
            Reload Extension
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

type Page =
  | "dashboard"
  | "audit"
  | "lists"
  | "review"
  | "unfollow"
  | "settings";

export interface NavigationParams {
  auditFilter?: string;
  followerMin?: number;
  followerMax?: number;
  sortBy?: string;
  sortDesc?: boolean;
}

export interface UnfollowProgress {
  total: number;
  done: number;
  isDryRun: boolean;
}

export type NavigateFn = (target: Page, params?: NavigationParams) => void;
export type ShowToastFn = (
  message: string,
  action?: { label: string; onClick: () => void },
) => void;

const navItems: Array<{ id: Page; label: string; icon: string }> = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "audit", label: "Audit", icon: "🔍" },
  { id: "lists", label: "Lists", icon: "📋" },
  { id: "review", label: "Review", icon: "🎯" },
  { id: "unfollow", label: "Unfollow", icon: "🧹" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

interface ToastState {
  message: string;
  action?: { label: string; onClick: () => void };
}

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [navParams, setNavParams] = useState<NavigationParams>({});
  const [toast, setToast] = useState<ToastState | null>(null);
  const [unfollowProgress, setUnfollowProgress] =
    useState<UnfollowProgress | null>(null);

  const navigateTo: NavigateFn = useCallback((target, params) => {
    setNavParams(params || {});
    setPage(target);
  }, []);

  const showToast: ShowToastFn = useCallback((message, action) => {
    setToast({ message, action });
  }, []);

  // Auto-dismiss toast after 4s
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Global unfollow progress listener — persists across page changes
  useEffect(() => {
    const listener = (message: {
      type: string;
      data?: { done: number; total: number; current: string; count: number };
    }) => {
      if (message.type === "UNFOLLOW_STARTED" && message.data) {
        setUnfollowProgress({
          total: message.data.total,
          done: 0,
          isDryRun: false,
        });
      }
      if (message.type === "UNFOLLOW_PROGRESS" && message.data) {
        setUnfollowProgress((prev) =>
          prev
            ? { ...prev, done: message.data!.done }
            : {
                total: message.data!.total,
                done: message.data!.done,
                isDryRun: false,
              },
        );
      }
      if (message.type === "UNFOLLOW_COMPLETE") {
        const count = message.data?.count ?? 0;
        setUnfollowProgress(null);
        showToast(`Done! Unfollowed ${count} accounts`);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [showToast]);

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen bg-x-bg text-x-text">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-x-border">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-x-accent">XSweep</span>
          </div>
        </header>

        {/* Unfollow Progress Banner — persists across page changes */}
        {unfollowProgress && (
          <div className="px-4 py-2 bg-x-card border-b border-x-border">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">
                {unfollowProgress.done === 0
                  ? "Starting cleanup..."
                  : `Unfollowing ${unfollowProgress.done} of ${unfollowProgress.total}`}
              </span>
              <span className="text-[10px] text-x-text-secondary">
                {unfollowProgress.total - unfollowProgress.done} left
              </span>
            </div>
            <div className="w-full bg-x-border rounded-full h-1.5">
              <div
                className="bg-x-accent rounded-full h-1.5 transition-all duration-500"
                style={{
                  width: `${unfollowProgress.total > 0 ? (unfollowProgress.done / unfollowProgress.total) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="text-[10px] text-x-text-secondary mt-1">
              Feel free to browse — this runs in the background
            </div>
          </div>
        )}

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          {page === "dashboard" && (
            <Dashboard navigateTo={navigateTo} showToast={showToast} />
          )}
          {page === "audit" && (
            <Audit
              initialFilter={navParams.auditFilter}
              initialFollowerMin={navParams.followerMin}
              initialFollowerMax={navParams.followerMax}
              initialSort={navParams.sortBy}
              initialSortDesc={navParams.sortDesc}
              navigateTo={navigateTo}
              showToast={showToast}
            />
          )}
          {page === "lists" && <Lists showToast={showToast} />}
          {page === "review" && (
            <Review navigateTo={navigateTo} showToast={showToast} />
          )}
          {page === "unfollow" && (
            <Unfollow navigateTo={navigateTo} showToast={showToast} />
          )}
          {page === "settings" && <Settings />}
        </main>

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-16 left-2 right-2 z-50 animate-in fade-in slide-in-from-bottom-2">
            <div className="bg-x-card border border-x-border rounded-lg px-4 py-3 flex items-center justify-between shadow-lg">
              <span className="text-sm text-x-text">{toast.message}</span>
              {toast.action && (
                <button
                  onClick={() => {
                    toast.action!.onClick();
                    setToast(null);
                  }}
                  className="text-sm font-medium text-x-accent hover:text-x-accent-hover ml-3 flex-shrink-0"
                >
                  {toast.action.label}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Bottom Nav */}
        <nav className="flex border-t border-x-border bg-x-bg">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setNavParams({});
                setPage(item.id);
              }}
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
    </ErrorBoundary>
  );
}
