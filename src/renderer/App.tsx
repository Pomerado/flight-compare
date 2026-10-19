import { useEffect, useMemo, useRef, useState } from "react";
import { fieldsFromSchema, initialValues, KIT_COPY, readForm } from "pomerado-app-kit/shared";
import {
  AppShell,
  AuthLost,
  BestPick,
  Button,
  ComparisonTable,
  ConnectScreen,
  EmptyState,
  QuotaHit,
  ResultCards,
  SchemaForm,
  SettingsSheet,
  SiteStatusList,
  useFanOut,
  usePomerado,
  useWideLayout,
} from "pomerado-app-kit/renderer";
import { COPY } from "@shared/copy";
import { bestPick, bestValue, lineUp, rank } from "@shared/rank";
import { ASK_LAYOUT, ASK_SCHEMA, askFieldOptions, askIssues, flightsFrom, runFor, toAsk, type Ask } from "@shared/search";
import { enabledSites } from "@shared/tools";
import { FlightCard, pickFor, TABLE_COLUMNS, valuePickFor } from "./flight-views";

/** Today in the person's own time zone, as YYYY-MM-DD. */
function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function PlaneMark() {
  return (
    <svg className="fc-plane" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M21 15.5v-1.8l-7.5-4.6V4a1.5 1.5 0 00-3 0v5.1L3 13.7v1.8l7.5-2.3v4.9l-2 1.5V21l3.5-1 3.5 1v-1.4l-2-1.5v-4.9z"
        fill="currentColor"
      />
    </svg>
  );
}

export function App() {
  const { state } = usePomerado();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const { bridge, setState, setQuota } = usePomerado();

  // Not connected means onboarding. It ends when the person leaves the "connected" screen.
  useEffect(() => {
    if (state && !state.connected) setOnboarding(true);
  }, [state]);

  const badge = state && state.environment !== "production" ? COPY.environment[state.environment] : undefined;

  async function reconnect() {
    setState(await bridge.disconnect());
    setQuota(null);
    setOnboarding(true);
  }

  return (
    <AppShell appName={COPY.appName} mark={<PlaneMark />} badge={badge} onSettings={() => setSettingsOpen(true)}>
      {state === null ? null : onboarding || !state.connected ? (
        <ConnectScreen appName={COPY.appName} onDone={() => setOnboarding(false)} />
      ) : (
        <Search onReconnect={() => void reconnect()} />
      )}
      {settingsOpen ? <SettingsSheet onClose={() => setSettingsOpen(false)} /> : null}
    </AppShell>
  );
}

function Search({ onReconnect }: { onReconnect: () => void }) {
  const { state } = usePomerado();
  const today = useMemo(localToday, []);
  const fields = useMemo(() => fieldsFromSchema(ASK_SCHEMA, askFieldOptions(today)), [today]);
  const [values, setValues] = useState(() => initialValues(ASK_SCHEMA));
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState<Ask | null>(null);
  const sites = useMemo(() => enabledSites(), []);
  const fanOut = useFanOut();
  const wide = useWideLayout(960);
  const results = useRef<HTMLElement>(null);
  const run = fanOut.state;

  function submit() {
    const read = readForm(fields, values);
    if (!read.ok) return setIssues(read.issues);
    const more = askIssues(read.input);
    if (Object.keys(more).length > 0) return setIssues(more);
    setIssues({});
    const next = toAsk(read.input);
    setAsk(next);
    fanOut.start(sites.map((site) => runFor(site, next, state?.siteTimeoutMs ?? null)));
    // On a phone the results sit under the form, so bring them into view.
    if (!wide) requestAnimationFrame(() => results.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const flights = useMemo(() => {
    if (!run || !ask) return [];
    return run.sites.flatMap((siteState) => {
      const site = sites.find((item) => item.alias === siteState.key);
      return site ? flightsFrom(site, siteState.pages, ask) : [];
    });
  }, [run, ask, sites]);
  const rows = useMemo(() => rank(lineUp(flights)), [flights]);
  const best = bestPick(rows);
  const value = bestValue(rows);
  const counts = useMemo(() => {
    const found = new Map<string, number>();
    for (const flight of flights) found.set(flight.source.key, (found.get(flight.source.key) ?? 0) + 1);
    return found;
  }, [flights]);

  const running = run?.running ?? false;
  const anyDone = run?.sites.some((site) => site.phase === "done") ?? false;
  const withMore = run?.sites.filter((site) => site.hasMore) ?? [];
  const loadingMore = run?.sites.some((site) => site.loadingMore) ?? false;
  const roundTrip = ask?.return_date !== undefined;

  return (
    <div className="fc-layout">
      <section className="fc-ask" aria-labelledby="fc-title">
        <h1 id="fc-title" className="fc-title">
          {COPY.ask.title}
        </h1>
        <p className="fc-lede">{COPY.ask.lede}</p>
        <SchemaForm
          fields={fields}
          values={values}
          issues={issues}
          layout={ASK_LAYOUT}
          optionalLabel={COPY.ask.optional}
          submitLabel={COPY.ask.submit}
          busy={running}
          note={COPY.ask.slowNote}
          onChange={(name, next) => {
            setValues((current) => ({ ...current, [name]: next }));
            if (issues[name]) setIssues(({ [name]: _gone, ...rest }) => rest);
          }}
          onSubmit={submit}
        />
        {running ? (
          <Button variant="quiet" className="fc-stop" onClick={fanOut.stop}>
            {KIT_COPY.search.stop}
          </Button>
        ) : null}
      </section>

      <section className="fc-results" ref={results} aria-label={COPY.ask.title}>
        {!run ? (
          <div className="fc-placeholder">
            <p className="fc-placeholder-title">{COPY.placeholder.title}</p>
            <p className="fc-placeholder-body">{COPY.placeholder.body}</p>
          </div>
        ) : (
          <>
            {run.authLost ? <AuthLost onReconnect={onReconnect} /> : null}
            {run.quota ? <QuotaHit resetAt={run.quota.resetAt} /> : null}
            <SiteStatusList
              sites={run.sites}
              summary={(site) => {
                const found = counts.get(site.key) ?? 0;
                return found === 0 ? COPY.results.none : COPY.results.count(found);
              }}
              onAnswer={fanOut.answer}
              onRetry={fanOut.retry}
            />
            {best ? <BestPick pick={pickFor(best)} testId="best-pick" /> : null}
            {value && value.row !== best ? (
              <BestPick pick={valuePickFor(value.row, value.program, value.cents)} tone="secondary" testId="best-value" />
            ) : null}
            {rows.length > 0 ? (
              <div className="fc-list">
                <p className="fc-rule">{COPY.results.rule}</p>
                {roundTrip ? <p className="fc-rule">{COPY.results.roundTripNote}</p> : null}
                {wide ? (
                  <ComparisonTable
                    columns={TABLE_COLUMNS}
                    rows={rows}
                    rowKey={(row) => row.key}
                    highlight={best?.key}
                    caption={COPY.ask.title}
                  />
                ) : (
                  <ResultCards rows={rows} rowKey={(row) => row.key} highlight={best?.key} render={(row) => <FlightCard row={row} />} />
                )}
                {withMore.length > 0 ? (
                  <Button busy={loadingMore} onClick={() => withMore.forEach((site) => fanOut.loadMore(site.key))}>
                    {loadingMore ? KIT_COPY.search.loadingMore : COPY.results.more}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {!running && rows.length === 0 && anyDone ? (
              <EmptyState title={COPY.results.emptyTitle} body={COPY.results.emptyBody} />
            ) : null}
            {!running && rows.length === 0 && !anyDone && !run.quota && !run.authLost && run.sites.every((site) => site.phase === "failed" || site.phase === "timed_out") ? (
              <EmptyState title={COPY.results.failedTitle} body={COPY.results.failedBody} />
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
