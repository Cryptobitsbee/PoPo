import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import WindowControls from "./WindowControls";
import { useAuth } from "../../hooks/useAuth";
import { useSessionSave } from "../../hooks/useSessionSave";
import { useHistorySync } from "../../hooks/useHistorySync";
import { useModesSync } from "../../hooks/useModesSync";
import { useSettingsSync } from "../../hooks/useSettingsSync";
import { useAppIconsSync } from "../../hooks/useAppIconsSync";
import { useSnippetsSync } from "../../hooks/useSnippetsSync";
import { useDictionarySync } from "../../hooks/useDictionarySync";
import { useSnippetUsageEvents } from "../../hooks/useSnippetUsageEvents";
import { useApplySettingsToRust } from "../../hooks/useApplySettingsToRust";
import { useAudioUpload } from "../../hooks/useAudioUpload";
import { useCrossWebviewSync } from "../../hooks/useCrossWebviewSync";
import FirstRunOverlay, {
  shouldShowFirstRun,
} from "../first-run/FirstRunOverlay";

/**
 * AppShell — the frameless main-window layout.
 *
 * Per brief §3:
 *   [64px sidebar --bg-void] | [flex-1 content --bg-base]
 *   Depth from color alone — NO border between sidebar and content.
 *   No top header bar — 40px drag region across both columns.
 *
 * Children rendered via react-router <Outlet /> using nested routing
 * (see App.tsx). Each route's component becomes the page content.
 *
 * Page transitions: INTENTIONALLY NONE. Session 30 polish: a page-level
 * fade + stagger combined with in-page staggered components (SessionRow,
 * StatCard, etc.) produced a perceived "flash then re-animate" lag. Desktop
 * apps in popo's reference set (Linear, Figma, VS Code) all swap pages
 * instantly. We do the same here and let each page's own component motion
 * carry the feel of arrival.
 *
 * Visible only on main-window routes. The pill route is NOT wrapped in
 * AppShell — see App.tsx for the routing structure.
 */

export default function AppShell() {
  // First-run overlay visibility. Read once at mount; the effect below
  // flips it off when either the user dismisses it or another tab
  // sets the localStorage flag. Shown above the entire AppShell when
  // this is the user's first launch post-install.
  const [showFirstRun, setShowFirstRun] = useState<boolean>(() =>
    shouldShowFirstRun(),
  );

  // Install the Firebase auth state listener once per main-window
  // lifetime. Subsequent renders are cheap (hook is idempotent).
  useAuth();

  // Save every successful dictation to Firestore (if signed in) and
  // immediately prepend it to the in-memory historyStore.
  useSessionSave();

  // Subscribe to Firestore sessions in real-time. Fires when the user
  // signs in, populating History with all past dictations.
  useHistorySync();

  // On sign-in, reconcile local modes with Firestore: push seeds if
  // remote is empty, otherwise replace local with remote.
  useModesSync();

  // On sign-in, reconcile local Settings (non-GCP) with Firestore.
  useSettingsSync();

  // On sign-in, subscribe to the deduped app-icons collection so every
  // machine sees icons for apps the user has dictated into from any
  // device (see appIconsStore).
  useAppIconsSync();

  // On sign-in, subscribe to Snippets + Dictionary so the user's
  // text-expansion shortcuts and Chirp 3 phrase hints follow them
  // across devices.
  useSnippetsSync();
  useDictionarySync();

  // Listen for Rust's `snippets:expanded` event and bump usageCount.
  useSnippetUsageEvents();

  // Push hotkey + mic selection from the settings store to the Rust
  // core (global-shortcut registration + cpal device pick).
  useApplySettingsToRust();

  // Upload audio to Firebase Storage when storeAudio is on + signed in.
  useAudioUpload();

  // Stay in sync with other Tauri webviews (the Quick switcher window
  // mutates settings + modes too). Without this, picking a mode in the
  // switcher would update the switcher's own JS store + localStorage
  // + Firestore, but the main window's Settings page would keep
  // displaying the old default until the next page reload. Symmetric
  // listener lives in QuickSwitcherPage. See `lib/cross-webview-sync.ts`
  // for the IPC-based bridge.
  useCrossWebviewSync();

  return (
    <div
      style={{
        display: "flex",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "var(--bg-void)", // absorbs the sidebar bg behind everything
      }}
    >
      <Sidebar />

      <main
        style={{
          flex: 1,
          position: "relative",
          background: "var(--bg-base)",
          overflow: "hidden",
          height: "100%",
        }}
      >
        {/*
          Drag region strip across top 40px of content. Window controls
          sit above it (zIndex) with drag-region="false" to stay clickable.
        */}
        <div
          data-tauri-drag-region
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 40,
            zIndex: 5,
          }}
          aria-hidden
        />

        <WindowControls />

        {/* Page content container */}
        <div
          style={{
            position: "absolute",
            top: 40,
            left: 0,
            right: 0,
            bottom: 0,
            overflow: "auto",
          }}
        >
          {/* Instant page swap — see top-of-file note. */}
          <Outlet />
        </div>
      </main>

      {/* First-run welcome overlay — covers the entire main window on
          fresh installs. Dismissed by Skip or successful sign-in. */}
      <AnimatePresence>
        {showFirstRun && (
          <FirstRunOverlay
            key="first-run"
            onDismiss={() => setShowFirstRun(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
