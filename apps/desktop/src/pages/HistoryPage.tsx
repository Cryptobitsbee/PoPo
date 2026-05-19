import { useMemo, useRef, useState } from "react";
import type { Session, Mode } from "@popo/shared-types";
import { useHistoryStore } from "../store/historyStore";
import { useModesStore } from "../store/modesStore";
import { useAppIconsStore } from "../store/appIconsStore";
import { useAuthStore } from "../store/authStore";
import { useSettingsStore } from "../store/settingsStore";
import {
  deleteSession as firestoreDeleteSession,
  deleteAppIcon as firestoreDeleteAppIcon,
} from "../lib/firestore";
import { trackSync } from "../store/syncLogStore";
import HistoryControls from "../components/history/HistoryControls";
import HistoryList from "../components/history/HistoryList";
import EmptyState, { StartHintSubline } from "../components/history/EmptyState";
import type { DateRange } from "../components/history/DateRangePicker";
import type { AppOption } from "../components/history/AppFilter";

/**
 * HistoryPage — brief §3 History.
 *
 * Data flow (Session 17 Firebase integration):
 *   - Sessions are written to Firestore by useSessionSave (mounted in
 *     AppShell) after every successful dictation.
 *   - useHistorySync (also in AppShell) subscribes to Firestore and
 *     calls historyStore.setAll() on every change, so this page just
 *     reads from the store. No synthetic seeding needed anymore.
 *   - When the user is NOT signed in, only in-session dictations show
 *     (added by useSessionSave's appendSessions call).
 */

export default function HistoryPage() {
  const sessions = useHistoryStore((s) => s.sessions);
  const localDeleteSession = useHistoryStore((s) => s.deleteSession);
  const modes = useModesStore((s) => s.modes);
  // Deduped icons keyed by app name. On sign-in this hydrates from
  // Firestore via useAppIconsSync; otherwise it fills as the user
  // dictates. We read the whole map so useMemo can bake the deduped
  // options in one pass.
  const iconsByName = useAppIconsStore((s) => s.iconsByName);
  const removeAppIconLocal = useAppIconsStore((s) => s.remove);
  const user = useAuthStore((s) => s.user);

  // Local UI state
  const [query, setQuery] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [appFilter, setAppFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Label of the bucket currently topmost in the viewport. Drives the
  // DateRangePicker's pill when no filter is active.
  const [currentSection, setCurrentSection] = useState<string>("Today");

  // Internal scroll container for the list. Using a nested scroll area
  // (not the AppShell's) keeps the title + controls + separator fixed
  // at the top of the page. Passed to HistoryList so its section-in-view
  // IntersectionObserver can observe visibility against this container
  // rather than the window.
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Derived: mode lookup + filtered sessions
  const modesById = useMemo<Record<string, Mode>>(
    () => Object.fromEntries(modes.map((m) => [m.id, m])),
    [modes],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (dateRange !== null) {
        if (s.createdAt < dateRange.from || s.createdAt > dateRange.to)
          return false;
      }
      if (appFilter !== null && s.appName !== appFilter) return false;
      if (q && !matchesQuery(s, modesById[s.modeId ?? ""], q)) return false;
      return true;
    });
  }, [sessions, modesById, query, dateRange, appFilter]);

  // Build the App filter's option list from the unfiltered session set
  // so the dropdown always shows every app the user has ever dictated
  // into (not just the currently-filtered view). Icons are resolved
  // from `appIconsStore` (the deduped map) with a fallback to whatever
  // was inlined on an older session doc.
  const appOptions: AppOption[] = useMemo(() => {
    const byName = new Map<string, { name: string; count: number }>();
    for (const s of sessions) {
      if (!s.appName) continue;
      const existing = byName.get(s.appName);
      if (existing) {
        existing.count += 1;
      } else {
        byName.set(s.appName, { name: s.appName, count: 1 });
      }
    }
    // Resolve icons from the deduped store. For apps not yet in the
    // store (e.g. offline-only first use) fall back to the session's
    // inline icon if one of its sessions still carries it.
    const inlineFallback = new Map<string, string>();
    for (const s of sessions) {
      if (s.appName && s.appIcon && !inlineFallback.has(s.appName)) {
        inlineFallback.set(s.appName, s.appIcon);
      }
    }
    // Sort by count desc then name asc so the most-used apps surface first.
    return Array.from(byName.values())
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map(({ name, count }) => ({
        name,
        iconBase64: iconsByName[name] ?? inlineFallback.get(name),
        count,
      }));
  }, [sessions, iconsByName]);

  // Handlers
  const handleCopy = async (session: Session) => {
    const text = session.formattedTranscript ?? session.rawTranscript;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback: do nothing visible. Phase 4 polish adds a toast.
    }
  };

  const handleDelete = (id: string) => {
    if (selectedId === id) setSelectedId(null);

    // Find the session BEFORE we strip it from the local store so we
    // can inspect its appName for the orphan-icon cleanup below.
    const victim = sessions.find((s) => s.id === id);

    // 1. Local delete — instant UI feedback.
    localDeleteSession(id);

    // 2. Firestore delete. Without this, `useHistorySync` restores the
    //    session from the remote snapshot the next time ANY sync
    //    event fires (e.g. the user saves a new dictation) — which
    //    is exactly the "deleted rows keep coming back" bug.
    const privacyMode = useSettingsStore.getState().settings.privacyMode;
    if (user?.uid && !privacyMode) {
      trackSync("delete", `users/${user.uid}/sessions/${id}`, () =>
        firestoreDeleteSession(user.uid, id),
      ).catch(() => {
        /* trackSync already surfaces the error to the sync log. */
      });
    }

    // 3. Orphan-icon cleanup. If no other session references the
    //    victim's appName we remove the icon locally + from Firestore.
    //    This matches the user's mental model ("used an app once,
    //    deleted the only session, so the icon goes too") while
    //    preserving icons for apps with remaining sessions.
    const appName = victim?.appName;
    if (appName) {
      const stillReferenced = sessions.some(
        (s) => s.id !== id && s.appName === appName,
      );
      if (!stillReferenced) {
        removeAppIconLocal(appName);
        if (user?.uid) {
          trackSync("delete", `users/${user.uid}/appIcons/${appName}`, () =>
            firestoreDeleteAppIcon(user.uid, appName),
          ).catch(() => {
            /* sync log carries the failure */
          });
        }
      }
    }
  };

  const totalCount = sessions.length;
  const filteredCount = filtered.length;
  const showEmpty = totalCount === 0;
  const showNoMatch = !showEmpty && filteredCount === 0;

  return (
    <div
      style={{
        height: "100%",
        maxWidth: 1040,
        margin: "0 auto",
        padding: "var(--sp-8) var(--sp-10) 0",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {/* Fixed header zone */}
      <div style={{ flexShrink: 0 }}>
        <h1
          style={{
            fontFamily: "var(--font-pixel-square)",
            fontSize: "var(--text-xl)",
            lineHeight: 1.1,
            fontWeight: 500,
            color: "var(--text-primary)",
            margin: 0,
          }}
        >
          History
        </h1>

        <HistoryControls
          totalCount={totalCount}
          filteredCount={filteredCount}
          query={query}
          onQueryChange={setQuery}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          currentSection={currentSection}
          appOptions={appOptions}
          appFilter={appFilter}
          onAppFilterChange={setAppFilter}
        />

        <div
          role="separator"
          style={{
            marginTop: "var(--sp-6)",
            height: 1,
            background: "var(--border-faint)",
          }}
        />
      </div>

      {/* Scrollable list */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          paddingBottom: "var(--sp-12)",
        }}
      >
        {showEmpty ? (
          <EmptyState subline={<StartHintSubline />} />
        ) : showNoMatch ? (
          <EmptyState
            headline="No matching sessions"
            subline={<>Try a different query or clear the search.</>}
          />
        ) : (
          <HistoryList
            sessions={filtered}
            modesById={modesById}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onCopy={handleCopy}
            onDelete={handleDelete}
            onSectionInView={setCurrentSection}
            scrollRoot={scrollRef}
          />
        )}
      </div>
    </div>
  );
}

/** Substring match across transcript + formatted + app name + mode name. */
function matchesQuery(
  session: Session,
  mode: Mode | undefined,
  q: string,
): boolean {
  if (session.rawTranscript.toLowerCase().includes(q)) return true;
  if (session.formattedTranscript?.toLowerCase().includes(q)) return true;
  if (session.appName?.toLowerCase().includes(q)) return true;
  if (mode?.name.toLowerCase().includes(q)) return true;
  return false;
}
