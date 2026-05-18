import { useEffect, useRef, useState } from "react";
import { MARCH_2026, type ReportPeriod } from "./lib/data";
import {
  hasCompleteCredentials,
  loadCredentials,
  saveCredentials,
  type Credentials,
} from "./lib/credentials";
import { importFromFile, ImportError } from "./lib/importer";
import {
  generateReport,
  GenerationCancelledError,
  type ProgressUpdate,
} from "./lib/reportGenerator";
import { type Timeframe } from "./lib/timeframe";
import {
  runComparison,
  type CompareEntry,
  type ComparisonResult,
} from "./lib/comparator";

import {
  ThemeToggle,
  applyTheme,
  loadTheme,
  saveTheme,
  type Theme,
} from "./components/ThemeToggle/ThemeToggle";
import { SettingsButton } from "./components/SettingsButton/SettingsButton";

import { LandingPage } from "./pages/LandingPage/LandingPage";
import { DashboardPage } from "./pages/DashboardPage/DashboardPage";
import { SettingsPage } from "./pages/SettingsPage/SettingsPage";
import { TimeframeSelector } from "./pages/TimeframeSelector/TimeframeSelector";
import { QueryPreview } from "./pages/QueryPreview/QueryPreview";
import { GeneratingView } from "./pages/GeneratingView/GeneratingView";
import { Report } from "./pages/Report/Report";
import { CompareSetupPage } from "./pages/CompareSetupPage/CompareSetupPage";
import { ComparisonView } from "./pages/ComparisonView/ComparisonView";
import { MultiTimeframePicker } from "./pages/MultiTimeframePicker/MultiTimeframePicker";

type View =
  | { kind: "landing" }
  | { kind: "dashboard" }
  | { kind: "preview" }
  | { kind: "imported"; timeframe: Timeframe; report: ReportPeriod; filename: string }
  | {
      kind: "settings";
      isOnboarding: boolean;
      initialTab?: "credentials" | "team";
    }
  | { kind: "selector" }
  | { kind: "prepare"; timeframe: Timeframe }
  | {
      kind: "generating";
      timeframe: Timeframe;
      progress: ProgressUpdate | null;
      error: string | null;
    }
  | {
      kind: "report";
      timeframe: Timeframe;
      report: ReportPeriod;
      warnings: string[];
    }
  | { kind: "compare-setup" }
  | { kind: "compare-pick-timeframe" }
  | {
      kind: "compare-generating-fresh";
      timeframe: Timeframe;
      progress: ProgressUpdate | null;
      error: string | null;
    }
  | { kind: "compare-pick-multi" }
  | {
      kind: "compare-generating-batch";
      queue: Timeframe[];
      currentIndex: number;
      progress: ProgressUpdate | null;
      error: string | null;
      completed: CompareEntry[];
    }
  | { kind: "compare-analyzing"; message: string; error: string | null }
  | { kind: "compare-result"; result: ComparisonResult };

export default function App() {
  const [credentials, setCredentials] = useState<Credentials>(() => loadCredentials());
  const credentialsComplete = hasCompleteCredentials(credentials);
  const [view, setView] = useState<View>({ kind: "landing" });
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [importError, setImportError] = useState<string | null>(null);
  const [compareEntries, setCompareEntries] = useState<CompareEntry[]>([]);
  const [compareImportError, setCompareImportError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  // Controls cancellation of the active generation pipeline (Jira/Claude). The
  // Cancel button on GeneratingView aborts this so in-flight fetches stop
  // immediately, rather than just hiding the UI while the work continues.
  const generateAbortRef = useRef<AbortController | null>(null);

  function cancelActiveGeneration() {
    cancelledRef.current = true;
    if (generateAbortRef.current && !generateAbortRef.current.signal.aborted) {
      generateAbortRef.current.abort();
    }
  }

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  function homeView(): View {
    return credentialsComplete ? { kind: "dashboard" } : { kind: "landing" };
  }

  function handleGetStarted() {
    if (credentialsComplete) {
      setView({ kind: "dashboard" });
    } else {
      setView({ kind: "settings", isOnboarding: true });
    }
  }

  function handlePreview() {
    setView({ kind: "preview" });
  }

  function handleGenerateFromDashboard() {
    setView({ kind: "selector" });
  }

  async function handleImport(file: File) {
    setImportError(null);
    try {
      const { timeframe, report } = await importFromFile(file);
      setView({ kind: "imported", timeframe, report, filename: file.name });
    } catch (err) {
      if (err instanceof ImportError) {
        setImportError(err.message);
      } else {
        setImportError(
          `Could not import ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  function openSettings(initialTab: "credentials" | "team" = "credentials") {
    setView({
      kind: "settings",
      isOnboarding: !credentialsComplete,
      initialTab,
    });
  }

  function handleSaveCredentials(creds: Credentials) {
    saveCredentials(creds);
    setCredentials(creds);
    setView({ kind: "dashboard" });
  }

  async function runGenerate(timeframe: Timeframe) {
    cancelledRef.current = false;
    generateAbortRef.current = new AbortController();
    const signal = generateAbortRef.current.signal;
    setView({ kind: "generating", timeframe, progress: null, error: null });
    try {
      const result = await generateReport(
        credentials,
        timeframe,
        (update) => {
          if (cancelledRef.current || signal.aborted) return;
          setView((v) =>
            v.kind === "generating" ? { ...v, progress: update } : v,
          );
        },
        signal,
      );
      if (cancelledRef.current) return;
      setView({
        kind: "report",
        timeframe,
        report: result.report,
        warnings: result.warnings,
      });
    } catch (err) {
      if (cancelledRef.current || err instanceof GenerationCancelledError) return;
      const message = err instanceof Error ? err.message : String(err);
      setView((v) =>
        v.kind === "generating" ? { ...v, error: message } : v,
      );
    }
  }

  function handleStartCompare() {
    setCompareEntries([]);
    setCompareImportError(null);
    setView({ kind: "compare-setup" });
  }

  async function handleCompareAddFile(file: File) {
    setCompareImportError(null);
    try {
      const { timeframe, report } = await importFromFile(file);
      const next: CompareEntry = {
        origin: "imported",
        filename: file.name,
        timeframe,
        report,
      };
      setCompareEntries((cur) => [...cur, next]);
    } catch (err) {
      if (err instanceof ImportError) {
        setCompareImportError(err.message);
      } else {
        setCompareImportError(
          `Could not import ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  function handleCompareRemove(index: number) {
    setCompareEntries((cur) => cur.filter((_, i) => i !== index));
  }

  function handleCompareAddFresh() {
    if (!credentialsComplete) {
      setView({ kind: "settings", isOnboarding: true });
      return;
    }
    setView({ kind: "compare-pick-timeframe" });
  }

  function handleCompareAddMultiple() {
    if (!credentialsComplete) {
      setView({ kind: "settings", isOnboarding: true });
      return;
    }
    setView({ kind: "compare-pick-multi" });
  }

  async function runCompareBatch(
    queue: Timeframe[],
    startIndex: number,
    seedCompleted: CompareEntry[],
  ) {
    cancelledRef.current = false;
    const completed = [...seedCompleted];
    for (let i = startIndex; i < queue.length; i++) {
      const tf = queue[i];
      generateAbortRef.current = new AbortController();
      const signal = generateAbortRef.current.signal;
      setView({
        kind: "compare-generating-batch",
        queue,
        currentIndex: i,
        progress: null,
        error: null,
        completed,
      });
      try {
        const result = await generateReport(
          credentials,
          tf,
          (update) => {
            if (cancelledRef.current || signal.aborted) return;
            setView((v) =>
              v.kind === "compare-generating-batch"
                ? { ...v, progress: update }
                : v,
            );
          },
          signal,
        );
        if (cancelledRef.current) return;
        completed.push({ origin: "live", timeframe: tf, report: result.report });
      } catch (err) {
        if (cancelledRef.current || err instanceof GenerationCancelledError) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setView({
          kind: "compare-generating-batch",
          queue,
          currentIndex: i,
          progress: null,
          error: message,
          completed,
        });
        return;
      }
    }
    setCompareEntries((cur) => [...cur, ...completed]);
    setView({ kind: "compare-setup" });
  }

  async function runCompareGenerate(timeframe: Timeframe) {
    cancelledRef.current = false;
    generateAbortRef.current = new AbortController();
    const signal = generateAbortRef.current.signal;
    setView({
      kind: "compare-generating-fresh",
      timeframe,
      progress: null,
      error: null,
    });
    try {
      const result = await generateReport(
        credentials,
        timeframe,
        (update) => {
          if (cancelledRef.current || signal.aborted) return;
          setView((v) =>
            v.kind === "compare-generating-fresh"
              ? { ...v, progress: update }
              : v,
          );
        },
        signal,
      );
      if (cancelledRef.current) return;
      const entry: CompareEntry = {
        origin: "live",
        timeframe,
        report: result.report,
      };
      setCompareEntries((cur) => [...cur, entry]);
      setView({ kind: "compare-setup" });
    } catch (err) {
      if (cancelledRef.current || err instanceof GenerationCancelledError) return;
      const message = err instanceof Error ? err.message : String(err);
      setView((v) =>
        v.kind === "compare-generating-fresh"
          ? { ...v, error: message }
          : v,
      );
    }
  }

  async function handleRunComparison() {
    if (compareEntries.length < 2) return;
    setView({ kind: "compare-analyzing", message: "Starting…", error: null });
    try {
      const result = await runComparison(credentials, compareEntries, (msg) => {
        setView((v) =>
          v.kind === "compare-analyzing" ? { ...v, message: msg } : v,
        );
      });
      setView({ kind: "compare-result", result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setView((v) =>
        v.kind === "compare-analyzing" ? { ...v, error: message } : v,
      );
    }
  }

  return (
    <>
      <ThemeToggle theme={theme} onToggle={toggleTheme} />

      {view.kind !== "settings" &&
      view.kind !== "landing" &&
      view.kind !== "preview" &&
      view.kind !== "imported" &&
      view.kind !== "compare-result" ? (
        <SettingsButton
          onClick={() => openSettings("credentials")}
          configured={credentialsComplete}
        />
      ) : null}

      {view.kind === "landing" ? (
        <LandingPage
          onGetStarted={handleGetStarted}
          onPreview={handlePreview}
          credentialsConfigured={credentialsComplete}
          projectKey={credentials.projectKey}
        />
      ) : null}

      {view.kind === "dashboard" ? (
        <DashboardPage
          projectKey={credentials.projectKey}
          onGenerate={handleGenerateFromDashboard}
          onImport={(file) => {
            void handleImport(file);
          }}
          onCompare={handleStartCompare}
          onPreview={handlePreview}
          importError={importError}
          dismissImportError={() => setImportError(null)}
        />
      ) : null}

      {view.kind === "preview" ? (
        <Report
          timeframe={{
            preset: "custom",
            label: MARCH_2026.label,
            start: MARCH_2026.rangeStart,
            end: MARCH_2026.rangeEnd,
          }}
          report={MARCH_2026}
          source="bundled"
          warnings={[]}
          credentials={credentials}
          backLabel="← Back to home"
          showStepProgress={false}
          onChangeTimeframe={() => setView(homeView())}
        />
      ) : null}

      {view.kind === "imported" ? (
        <Report
          timeframe={view.timeframe}
          report={view.report}
          source="imported"
          warnings={[`Imported from ${view.filename}`]}
          credentials={credentials}
          backLabel="← Back to home"
          showStepProgress={false}
          onChangeTimeframe={() => setView(homeView())}
        />
      ) : null}

      {view.kind === "settings" ? (
        <SettingsPage
          initial={credentials}
          isOnboarding={view.isOnboarding}
          initialTab={view.initialTab ?? "credentials"}
          onSave={handleSaveCredentials}
          onCancel={
            credentialsComplete ? () => setView({ kind: "dashboard" }) : undefined
          }
        />
      ) : null}

      {view.kind === "selector" ? (
        <TimeframeSelector
          onSelect={(timeframe) => setView({ kind: "prepare", timeframe })}
        />
      ) : null}

      {view.kind === "prepare" ? (
        <QueryPreview
          timeframe={view.timeframe}
          jqlConfig={{
            projectKey: credentials.projectKey,
            escalationColumns: credentials.escalationColumns,
            resolvedStatuses: credentials.resolvedStatuses,
          }}
          canGenerate={credentialsComplete}
          onBack={() => setView({ kind: "selector" })}
          onGenerate={() => {
            if (!credentialsComplete) {
              openSettings("credentials");
              return;
            }
            void runGenerate(view.timeframe);
          }}
        />
      ) : null}

      {view.kind === "generating" ? (
        <GeneratingView
          timeframe={view.timeframe}
          progress={view.progress}
          error={view.error}
          onCancel={() => {
            cancelActiveGeneration();
            setView({ kind: "prepare", timeframe: view.timeframe });
          }}
          onRetry={() => void runGenerate(view.timeframe)}
        />
      ) : null}

      {view.kind === "report" ? (
        <Report
          timeframe={view.timeframe}
          report={view.report}
          source="live"
          warnings={view.warnings}
          credentials={credentials}
          onChangeTimeframe={() => setView({ kind: "selector" })}
        />
      ) : null}

      {view.kind === "compare-setup" ? (
        <CompareSetupPage
          entries={compareEntries}
          credentialsConfigured={credentialsComplete}
          importError={compareImportError}
          onAddFromFile={(file) => {
            void handleCompareAddFile(file);
          }}
          onAddFreshFromJira={handleCompareAddFresh}
          onAddMultipleFromJira={handleCompareAddMultiple}
          onRemove={handleCompareRemove}
          onCompare={() => {
            void handleRunComparison();
          }}
          onBack={() => setView(homeView())}
          dismissImportError={() => setCompareImportError(null)}
        />
      ) : null}

      {view.kind === "compare-pick-timeframe" ? (
        <div className="prepare-page">
          <header className="prepare-header">
            <h1>Pick a timeframe to add</h1>
            <p className="selector-intro">
              This timeframe will be generated fresh from Jira and appended to the
              comparison.
            </p>
          </header>
          <TimeframeSelector
            onSelect={(timeframe) => {
              void runCompareGenerate(timeframe);
            }}
          />
          <div className="prepare-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setView({ kind: "compare-setup" })}
            >
              ← Back to comparison
            </button>
          </div>
        </div>
      ) : null}

      {view.kind === "compare-generating-fresh" ? (
        <GeneratingView
          timeframe={view.timeframe}
          progress={view.progress}
          error={view.error}
          showStepProgress={false}
          onCancel={() => {
            cancelActiveGeneration();
            setView({ kind: "compare-setup" });
          }}
          onRetry={() => void runCompareGenerate(view.timeframe)}
        />
      ) : null}

      {view.kind === "compare-pick-multi" ? (
        <MultiTimeframePicker
          existingEntries={compareEntries}
          onCancel={() => setView({ kind: "compare-setup" })}
          onSubmit={(timeframes) => {
            void runCompareBatch(timeframes, 0, []);
          }}
        />
      ) : null}

      {view.kind === "compare-generating-batch" ? (
        <GeneratingView
          timeframe={view.queue[view.currentIndex]}
          progress={view.progress}
          error={view.error}
          showStepProgress={false}
          batch={{
            index: view.currentIndex,
            total: view.queue.length,
            completedLabels: view.queue
              .slice(0, view.currentIndex)
              .map((t) => t.label),
            upcomingLabels: view.queue
              .slice(view.currentIndex + 1)
              .map((t) => t.label),
          }}
          onCancel={() => {
            cancelActiveGeneration();
            // Preserve already-finished reports so the user doesn't lose work.
            if (view.completed.length > 0) {
              setCompareEntries((cur) => [...cur, ...view.completed]);
            }
            setView({ kind: "compare-setup" });
          }}
          onRetry={() =>
            void runCompareBatch(view.queue, view.currentIndex, view.completed)
          }
        />
      ) : null}

      {view.kind === "compare-analyzing" ? (
        <div className="prepare-page">
          <header className="prepare-header">
            <h1>{view.error ? "Comparison failed" : "Comparing periods…"}</h1>
            <p className="selector-intro">
              {view.error
                ? "Claude couldn't produce the comparison."
                : view.message}
            </p>
          </header>
          {view.error ? (
            <div className="callout tone-danger">
              <strong>Error</strong>
              <p>{view.error}</p>
            </div>
          ) : (
            <div className="generating-card">
              <p className="phase-status muted small">{view.message}</p>
            </div>
          )}
          <div className="prepare-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setView({ kind: "compare-setup" })}
            >
              ← Back to comparison
            </button>
            {view.error ? (
              <button
                type="button"
                className="primary-button"
                onClick={() => void handleRunComparison()}
              >
                Retry
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {view.kind === "compare-result" ? (
        <ComparisonView
          result={view.result}
          onBack={() => {
            setCompareEntries([]);
            setView(homeView());
          }}
        />
      ) : null}
    </>
  );
}
