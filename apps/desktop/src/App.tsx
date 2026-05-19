import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import PillPage from "./pages/PillPage";
import QuickSwitcherPage from "./pages/QuickSwitcherPage";
import HistoryPage from "./pages/HistoryPage";
import ModesPage from "./pages/ModesPage";
import SnippetsPage from "./pages/SnippetsPage";
import DictionaryPage from "./pages/DictionaryPage";
import TestPage from "./pages/TestPage";
import StatsPage from "./pages/StatsPage";
import SettingsPage from "./pages/SettingsPage";
import AccountPage from "./pages/AccountPage";

/**
 * App — top-level routing.
 *
 * Three webviews, one React tree:
 *   - /pill → PillPage (transparent overlay; no shell)
 *   - /switcher → QuickSwitcherPage (transparent floating mode picker;
 *     opened by Ctrl+Shift+M — see Rust `show_mode_switcher`)
 *   - everything else → AppShell (frameless main window with sidebar +
 *     content). Pages render inside <Outlet />.
 *
 * The first-run welcome experience (splash + hotkey demo + sign-in
 * prompt) is an in-app overlay rendered by AppShell on top of the
 * page content — not a separate route or window. See
 * components/first-run/FirstRunOverlay.tsx.
 *
 * AnimatePresence for route transitions lives in AppShell, so the pill
 * route bypasses it entirely.
 */
export default function App() {
  return (
    <Routes>
      {/* Pill webview — standalone, no shell */}
      <Route path="/pill" element={<PillPage />} />

      {/* Quick mode switcher webview — standalone, no shell */}
      <Route path="/switcher" element={<QuickSwitcherPage />} />

      {/* Main webview — wrapped in AppShell for sidebar + transitions */}
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/history" replace />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/modes" element={<ModesPage />} />
        <Route path="/snippets" element={<SnippetsPage />} />
        <Route path="/dictionary" element={<DictionaryPage />} />
        <Route path="/test" element={<TestPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/account" element={<AccountPage />} />
      </Route>
    </Routes>
  );
}
