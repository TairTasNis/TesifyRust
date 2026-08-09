import React from 'react';
import { Download, Loader2, Check, XCircle, X, RefreshCw } from 'lucide-react';

export interface DownloadTaskUI {
  task_id: string;
  name: string;
  state: string;
  progress: number;
  downloaded_bytes: number;
  total_bytes: number | null;
  speed_bps: number | null;
  eta_secs: number | null;
  error: string | null;
  finished_at: number | null;
}

const ACTIVE_STATES = ['queued', 'downloading', 'processing', 'retrying'];

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
};

const formatSpeed = (bps: number | null): string => {
  if (!bps || bps <= 0) return '';
  return `${formatBytes(bps)}/с`;
};

const formatEta = (secs: number | null): string => {
  if (secs == null || secs < 0) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const stateLabel = (t: DownloadTaskUI): string => {
  if (t.state === 'queued') return 'В очереди...';
  if (t.state === 'retrying') return t.error || 'Повторная попытка...';
  if (t.state === 'processing') return 'Обработка...';
  if (t.state === 'done') return 'Готово';
  if (t.state === 'error') return t.error || 'Ошибка';
  if (t.progress >= 0 && t.total_bytes) {
    return `${formatBytes(t.downloaded_bytes)} / ${formatBytes(t.total_bytes)}`;
  }
  return `${formatBytes(t.downloaded_bytes)}`;
};

interface Props {
  tasks: DownloadTaskUI[];
  onClose: () => void;
}

const DownloadsPanel: React.FC<Props> = ({ tasks, onClose }) => {
  if (!tasks || tasks.length === 0) return null;

  const active = tasks.filter((t) => ACTIVE_STATES.includes(t.state));
  const done = tasks.filter((t) => t.state === 'done');
  const failed = tasks.filter((t) => t.state === 'error');
  const totalSpeed = active.reduce((sum, t) => sum + (t.speed_bps || 0), 0);
  const total = tasks.length;

  const overallPercent =
    tasks.length > 0
      ? tasks.reduce((sum, t) => {
          if (t.state === 'done') return sum + 100;
          if (t.state === 'error') return sum + 0;
          return sum + Math.max(0, Math.min(100, t.progress));
        }, 0) / tasks.length
      : 0;

  const anyFailed = failed.length > 0;

  return (
    <div className="fixed bottom-[120px] right-4 z-40 w-[360px] max-w-[calc(100vw-24px)] bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-3 animate-in slide-in-from-bottom-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Download size={16} className="text-green-500 shrink-0" />
          <span className="text-sm font-bold">Загрузки</span>
          <span className={`text-xs font-semibold shrink-0 ${anyFailed ? 'text-rose-400' : 'text-zinc-400'}`}>
            {done.length} из {total} скачано
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-white transition-colors p-0.5"
          title="Скрыть панель загрузок"
        >
          <X size={16} />
        </button>
      </div>

      {/* Overall progress */}
      {total > 1 && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
            <span>Общий прогресс</span>
            <span className="text-white font-semibold">{Math.round(overallPercent)}%</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${anyFailed ? 'bg-gradient-to-r from-rose-500 to-orange-400' : 'bg-gradient-to-r from-green-500 to-emerald-400'}`}
              style={{ width: `${Math.min(100, Math.max(0, overallPercent))}%` }}
            />
          </div>
        </div>
      )}

      {active.length > 0 && (
        <p className="text-[11px] text-zinc-400 mb-2">
          {active.length > 1 && <>Активно: {active.length} • </>}
          Скорость: <span className="text-white font-semibold">{formatSpeed(totalSpeed) || '—'}</span>
        </p>
      )}

      <div className="space-y-2.5 max-h-64 overflow-y-auto no-scrollbar pr-1">
        {tasks.map((t) => {
          const isError = t.state === 'error';
          const isRetrying = t.state === 'retrying';
          const isDone = t.state === 'done';
          const indeterminate = t.progress < 0;
          const showBar = !isError && !isDone && !isRetrying;
          return (
            <div key={t.task_id} className={`rounded-xl px-3 py-2 ${isError ? 'bg-rose-500/10 border border-rose-500/20' : isRetrying ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-white/5'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium truncate" title={t.name}>
                  {t.name}
                </span>
                {t.state === 'queued' && <Loader2 size={14} className="animate-spin text-zinc-400 shrink-0" />}
                {t.state === 'downloading' && t.progress >= 0 && (
                  <span className="text-xs font-bold text-white shrink-0">{Math.round(t.progress)}%</span>
                )}
                {(t.state === 'processing' || indeterminate) && (
                  <Loader2 size={14} className="animate-spin text-green-500 shrink-0" />
                )}
                {isRetrying && <RefreshCw size={14} className="animate-spin text-amber-400 shrink-0" />}
                {isDone && <Check size={14} className="text-green-500 shrink-0" />}
                {isError && <XCircle size={14} className="text-rose-500 shrink-0" />}
              </div>

              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mt-2">
                {showBar ? (
                  indeterminate ? (
                    <div className="h-full w-full bg-gradient-to-r from-green-500/40 via-emerald-400 to-green-500/40 animate-pulse rounded-full" />
                  ) : (
                    <div
                      className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(0, t.progress))}%` }}
                    />
                  )
                ) : isError ? (
                  <div className="h-full bg-rose-500 rounded-full" style={{ width: '100%' }} />
                ) : isRetrying ? (
                  <div className="h-full bg-amber-400 rounded-full" style={{ width: '100%' }} />
                ) : (
                  <div className="h-full bg-green-500 rounded-full" style={{ width: '100%' }} />
                )}
              </div>

              <div className="flex items-center justify-between gap-2 mt-1.5">
                <span className={`text-[10px] truncate ${isError ? 'text-rose-400' : isRetrying ? 'text-amber-400' : 'text-zinc-400'}`}>
                  {stateLabel(t)}
                </span>
                {t.state === 'downloading' && (
                  <span className="text-[10px] text-zinc-400 shrink-0">
                    {formatSpeed(t.speed_bps)}
                    {t.eta_secs != null && t.eta_secs >= 0 && (
                      <> • ETA {formatEta(t.eta_secs)}</>
                    )}
                  </span>
                )}
                {isRetrying && (
                  <span className="text-[10px] text-amber-400/80 shrink-0">Повторная попытка...</span>
                )}
              </div>

              {isError && t.error && (
                <p className="text-[10px] text-rose-400/90 mt-1.5 leading-snug break-words line-clamp-2" title={t.error}>
                  {t.error}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DownloadsPanel;
