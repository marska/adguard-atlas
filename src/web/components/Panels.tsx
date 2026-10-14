import type { CSSProperties, ReactNode } from 'react';
import { QUERY_CLASSES, type AtlasEvent, type QueryClass } from '../../shared/types';
import { filtersActive, placeKey, type AtlasStore, type Row, type Snapshot } from '../store';
import { CLASS_HINT, CLASS_LABEL, ClassGlyph, Domain, fmt, fmtCompact, fmtShare, fmtTime, Icon, whereOf } from './bits';

interface PanelProps {
  store: AtlasStore;
  snap: Snapshot;
  windowMinutes: number;
  privacyForced: boolean;
}

const width = (fraction: number) => ({ '--w': Math.max(0.02, fraction).toFixed(3) }) as CSSProperties;

function deviceLabel(store: AtlasStore, name: string, snap: Snapshot, forced: boolean): string {
  // When masking is forced the server has already replaced the names.
  return snap.privacy && !forced ? store.alias(name) : name;
}

// --- counters (F15) -----------------------------------------------------------

function Sparkline({ buckets }: { buckets: Snapshot['view']['buckets'] }) {
  const max = Math.max(1, ...buckets.map((b) => b[0] + b[1] + b[2]));
  return (
    <div className="spark" aria-hidden>
      {buckets.map((b, i) => {
        const total = b[0] + b[1] + b[2];
        const style = {
          '--h': `${total === 0 ? 0 : Math.max(4, (total / max) * 100)}%`,
          '--blocked': total === 0 ? '0%' : `${(b[1] / total) * 100}%`,
        } as CSSProperties;
        return <i key={i} style={style} />;
      })}
    </div>
  );
}

function TopList({
  title,
  rows,
  render,
  onPick,
  hint,
  mono,
}: {
  title: string;
  rows: Row[];
  render: (row: Row) => ReactNode;
  onPick: (row: Row) => void;
  hint: string;
  mono?: boolean;
}) {
  const max = rows[0]?.count ?? 1;
  return (
    <section className="block">
      <h3 className="eyebrow">{title}</h3>
      {rows.length === 0 ? (
        <p className="empty">Nothing yet</p>
      ) : (
        <ol className="bars">
          {rows.map((row) => (
            <li key={row.key}>
              <button type="button" className="bar" style={width(row.count / max)} onClick={() => onPick(row)} title={hint}>
                <span className={mono ? 'bar-label mono' : 'bar-label'}>{render(row)}</span>
                {row.blocked > 0 && row.blocked === row.count && <span className="bar-tag">blocked</span>}
                <span className="bar-count">{fmtCompact(row.count)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function StatsPanel({ store, snap, windowMinutes, privacyForced }: PanelProps) {
  const { view, filters } = snap;
  const seen = QUERY_CLASSES.reduce((sum, c) => sum + view.byClass[c], 0);

  return (
    <aside className="panel stats" aria-label="Counters">
      <div className="hero">
        <div className="metric">
          <span className="eyebrow">Queries · {windowMinutes} min</span>
          <strong className="metric-value">{fmtCompact(view.total)}</strong>
          <span className="metric-sub">{fmt(view.perMinute)} in the last minute</span>
        </div>
        <div className="metric metric-blocked">
          <span className="eyebrow">Blocked</span>
          <strong className="metric-value">{fmtShare(view.blockedShare)}</strong>
          <span className="metric-sub">{fmt(view.byClass.blocked)} refused</span>
        </div>
      </div>

      <Sparkline buckets={view.buckets} />
      <div className="spark-axis" aria-hidden>
        <span>−{windowMinutes} min</span>
        <span>now</span>
      </div>

      <section className="block">
        <div className="mix" aria-hidden>
          {QUERY_CLASSES.map((cls) => (
            <i key={cls} className={`mix-${cls}`} style={{ flexGrow: view.byClass[cls] } as CSSProperties} />
          ))}
        </div>
        <ul className="classes">
          {QUERY_CLASSES.map((cls: QueryClass) => (
            <li key={cls}>
              <button
                type="button"
                className={`class class-${cls}`}
                aria-pressed={filters.classes[cls]}
                onClick={() => store.toggleClass(cls)}
                title={`${CLASS_HINT[cls]}. Click to ${filters.classes[cls] ? 'hide' : 'show'}.`}
              >
                <ClassGlyph cls={cls} />
                <span className="class-name">{CLASS_LABEL[cls]}</span>
                <span className="class-count">{fmtCompact(view.byClass[cls])}</span>
                <span className="class-share">{seen ? fmtShare(view.byClass[cls] / seen) : '—'}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <TopList
        title={`Top countries${view.countries > 0 ? ` · ${view.countries}` : ''}`}
        rows={view.topCountries}
        hint="Show what is behind this country"
        render={(row) => (
          <>
            {row.cc && <span className="cc">{row.cc}</span>}
            {row.label}
          </>
        )}
        onPick={(row) => store.select({ kind: 'country', cc: row.cc ?? '', name: row.label })}
      />
      <TopList
        title="Top domains"
        rows={view.topDomains}
        mono
        hint={snap.privacy ? 'Hidden by privacy mode' : 'Filter by this domain'}
        render={(row) => <Domain value={row.label} privacy={snap.privacy} />}
        onPick={(row) => {
          if (!snap.privacy && !row.key.startsWith('~')) store.setFilters({ text: row.key });
        }}
      />
      <TopList
        title="Top devices"
        rows={view.topDevices}
        hint="Filter the map to this device"
        render={(row) => deviceLabel(store, row.label, snap, privacyForced)}
        onPick={(row) => store.setFilters({ device: filters.device === row.key ? null : row.key })}
      />
    </aside>
  );
}

// --- filters (F16) ------------------------------------------------------------

function Filters({ store, snap, privacyForced }: PanelProps) {
  const { view, filters, privacy } = snap;
  const active = filtersActive(filters);
  return (
    <div className="filters">
      {!privacy && (
        <label className="field field-search">
          <Icon name="search" size={14} />
          <input
            type="search"
            value={filters.text}
            placeholder="Filter by domain or device"
            aria-label="Filter by domain or device"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => store.setFilters({ text: e.target.value })}
          />
        </label>
      )}
      <div className="filter-row">
        <label className="field field-select" data-active={filters.device !== null}>
          <select
            value={filters.device ?? ''}
            aria-label="Device"
            onChange={(e) => store.setFilters({ device: e.target.value || null })}
          >
            <option value="">All devices</option>
            {view.devices.map((d) => (
              <option key={d} value={d}>
                {deviceLabel(store, d, snap, privacyForced)}
              </option>
            ))}
          </select>
        </label>
        {view.instances.length > 1 && (
          <label className="field field-select" data-active={filters.instance !== null}>
            <select
              value={filters.instance ?? ''}
              aria-label="AdGuard Home instance"
              onChange={(e) => store.setFilters({ instance: e.target.value || null })}
            >
              <option value="">All instances</option>
              {view.instances.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>
        )}
        {active > 0 && (
          <button type="button" className="reset" onClick={() => store.clearFilters()}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

// --- live feed (F14) ----------------------------------------------------------

function FeedRow({ e, store, snap, forced }: { e: AtlasEvent; store: AtlasStore; snap: Snapshot; forced: boolean }) {
  const body = (
    <>
      <ClassGlyph cls={e.cls} />
      <span className="row-main">
        <span className="row-domain">
          <Domain value={e.domain} privacy={snap.privacy} />
        </span>
        <span className="row-meta">
          <span className="row-device">{deviceLabel(store, e.client, snap, forced)}</span>
          <span className="row-where">{whereOf(e)}</span>
        </span>
      </span>
      <time className="row-time">{fmtTime(e.t)}</time>
    </>
  );
  const dest = e.dest;
  return (
    <li className={`row row-${e.cls}`}>
      {dest ? (
        <button type="button" onClick={() => store.select({ kind: 'place', key: placeKey(dest) })} title="Show this place">
          {body}
        </button>
      ) : (
        <div>{body}</div>
      )}
    </li>
  );
}

function Feed({ store, snap, privacyForced }: PanelProps) {
  const { view } = snap;
  return (
    <>
      <div className="side-head">
        <h2 className="eyebrow">
          <span className={snap.paused ? 'live-dot is-paused' : 'live-dot'} />
          Live feed
        </h2>
        <span className="side-note">{snap.paused ? 'map paused · feed still collecting' : 'newest first'}</span>
      </div>
      {view.feed.length === 0 ? (
        <p className="empty empty-feed">
          {!snap.ready
            ? 'Connecting…'
            : filtersActive(snap.filters) > 0
              ? 'No query in the window matches these filters.'
              : 'Waiting for the first query…'}
        </p>
      ) : (
        <ol className="feed">
          {view.feed.map((e) => (
            <FeedRow key={e.id} e={e} store={store} snap={snap} forced={privacyForced} />
          ))}
        </ol>
      )}
    </>
  );
}

// --- click-through (F17) ------------------------------------------------------

function DetailList({ title, rows, render, onPick }: { title: string; rows: Row[]; render: (row: Row) => ReactNode; onPick?: (row: Row) => void }) {
  if (rows.length === 0) return null;
  const max = rows[0]!.count;
  return (
    <section className="block">
      <h3 className="eyebrow">{title}</h3>
      <ol className="bars">
        {rows.map((row) => (
          <li key={row.key}>
            <button type="button" className="bar" style={width(row.count / max)} onClick={() => onPick?.(row)} disabled={!onPick}>
              <span className="bar-label mono">{render(row)}</span>
              <span className="bar-count">{fmtCompact(row.count)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DetailView({ store, snap, privacyForced }: PanelProps) {
  const detail = snap.view.detail!;
  const kind = snap.selection?.kind === 'country' ? 'Country' : 'Place';
  return (
    <>
      <div className="side-head detail-head">
        <div>
          <span className="eyebrow">{kind}</span>
          <h2 className="detail-title">{detail.title}</h2>
          {detail.subtitle && <span className="side-note">{detail.subtitle}</span>}
        </div>
        <button type="button" className="icon-button" onClick={() => store.select(null)} aria-label="Close" title="Close (Esc)">
          <Icon name="close" />
        </button>
      </div>
      <div className="detail-body">
        {detail.total === 0 ? (
          <p className="empty">No located query ended here in the current window.</p>
        ) : (
          <>
            <p className="detail-total">
              <strong>{fmt(detail.total)}</strong> {detail.total === 1 ? 'query' : 'queries'} in the window
            </p>
            <DetailList
              title="Domains"
              rows={detail.domains}
              render={(row) => <Domain value={row.label} privacy={snap.privacy} />}
              onPick={snap.privacy ? undefined : (row) => store.setFilters({ text: row.key })}
            />
            <DetailList
              title="Devices"
              rows={detail.devices}
              render={(row) => deviceLabel(store, row.label, snap, privacyForced)}
              onPick={(row) => store.setFilters({ device: row.key })}
            />
            <DetailList
              title="Places"
              rows={detail.cities}
              render={(row) => row.label}
              onPick={(row) => store.select({ kind: 'place', key: row.key })}
            />
          </>
        )}
      </div>
    </>
  );
}

export function SidePanel(props: PanelProps) {
  return (
    <aside className="panel side" aria-label={props.snap.view.detail ? 'Details' : 'Live feed'}>
      <Filters {...props} />
      {props.snap.view.detail ? <DetailView {...props} /> : <Feed {...props} />}
    </aside>
  );
}
