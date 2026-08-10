import React from 'react';
import { ArrowLeft, Check, Clock3, Download, Loader2, Maximize2, RefreshCw, X, XCircle } from 'lucide-react';
import { Track } from '../types';

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
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
};

const formatSpeed = (bps: number | null): string => {
  if (!bps || bps <= 0) return '';
  return `${formatBytes(bps)}/с`;
};

const formatEta = (secs: number | null): string => {
  if (secs == null || secs < 0) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const stateLabel = (task: DownloadTaskUI): string => {
  if (task.state === 'queued') return 'В очереди';
  if (task.state === 'retrying') return 'Повторная попытка';
  if (task.state === 'processing') return 'Обработка';
  if (task.state === 'done') return 'Готово';
  if (task.state === 'error') return 'Ошибка';
  return 'Скачивание';
};

interface SharedProps {
  tasks: DownloadTaskUI[];
  pendingCount?: number;
  totalCount?: number;
  currentTrack?: Track | null;
  queuedTracks?: Track[];
}

interface PanelProps extends SharedProps {
  onClose: () => void;
  onOpenPage: () => void;
}

interface DetailsProps extends SharedProps {
  onBack: () => void;
}

const getSummary = (tasks: DownloadTaskUI[], pendingCount: number, totalCount: number) => {
  const done = tasks.filter((task) => task.state === 'done').length;
  const failed = tasks.filter((task) => task.state === 'error').length;
  const total = Math.max(totalCount, pendingCount, tasks.length);
  const processed = done + failed;
  return { done, failed, total, processed, percent: total > 0 ? (processed / total) * 100 : 0 };
};

const CurrentDownload: React.FC<{ task?: DownloadTaskUI; track?: Track | null }> = ({ task, track }) => {
  const name = task?.name || (track ? `${track.title} — ${track.artist}` : 'Подготовка загрузки...');
  const progress = task?.progress != null && task.progress >= 0 ? task.progress : 0;

  return (
    <div className="rounded-xl bg-white/5 border border-white/10 p-3">
      <div className="flex items-center gap-2 min-w-0">
        <Loader2 size={15} className="animate-spin text-green-400 shrink-0" />
        <span className="text-xs text-zinc-400 shrink-0">Сейчас:</span>
        <span className="text-sm font-semibold truncate" title={name}>{name}</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mt-2">
        <div className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all duration-300" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
      </div>
      <div className="flex items-center justify-between gap-3 mt-1.5 text-[10px] text-zinc-400">
        <span>{task ? stateLabel(task) : 'Подготовка...'}</span>
        <span>
          {task?.progress != null && task.progress >= 0 ? `${Math.round(task.progress)}%` : ''}
          {task?.eta_secs != null && task.eta_secs >= 0 ? ` · ETA ${formatEta(task.eta_secs)}` : ''}
          {task?.speed_bps ? ` · ${formatSpeed(task.speed_bps)}` : ''}
        </span>
      </div>
    </div>
  );
};

const DownloadsPanel: React.FC<PanelProps> = ({
  tasks,
  pendingCount = 0,
  totalCount = 0,
  currentTrack,
  onClose,
  onOpenPage,
}) => {
  if ((!tasks || tasks.length === 0) && pendingCount === 0 && totalCount === 0) return null;

  const summary = getSummary(tasks, pendingCount, totalCount);
  const activeTask = tasks.find((task) => ACTIVE_STATES.includes(task.state));
  const hasFailed = summary.failed > 0;

  return (
    <div className="fixed bottom-[120px] right-4 z-[60] w-[380px] max-w-[calc(100vw-24px)] bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-3 animate-in slide-in-from-bottom-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Download size={16} className="text-green-500 shrink-0" />
          <span className="text-sm font-bold">Загрузки</span>
          <span className={`text-xs font-semibold ${hasFailed ? 'text-rose-400' : 'text-zinc-400'}`}>
            {summary.processed} / {summary.total}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onOpenPage} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10" title="Открыть все загрузки">
            <Maximize2 size={15} />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10" title="Скрыть панель">
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
        <span>Общий прогресс треков</span>
        <span className="text-white font-semibold">{Math.round(summary.percent)}%</span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden mb-3">
        <div className={`h-full rounded-full transition-all duration-500 ${hasFailed ? 'bg-gradient-to-r from-rose-500 to-orange-400' : 'bg-gradient-to-r from-green-500 to-emerald-400'}`} style={{ width: `${Math.min(100, Math.max(0, summary.percent))}%` }} />
      </div>

      <CurrentDownload task={activeTask} track={currentTrack} />
      {summary.failed > 0 && <p className="text-[10px] text-rose-400 mt-2">Ошибок: {summary.failed}</p>}
    </div>
  );
};

export const DownloadsDetailsPage: React.FC<DetailsProps> = ({
  tasks,
  pendingCount = 0,
  totalCount = 0,
  currentTrack,
  queuedTracks = [],
  onBack,
}) => {
  const summary = getSummary(tasks, pendingCount, totalCount);
  const activeTask = tasks.find((task) => ACTIVE_STATES.includes(task.state));

  return (
    <div className="fixed inset-0 z-[100] bg-zinc-950 text-white flex flex-col">
      <header className="flex items-center justify-between gap-4 px-5 py-4 border-b border-white/10 bg-zinc-900/95">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onBack} className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10" title="Назад">
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">Все загрузки</h1>
            <p className="text-xs text-zinc-400">Обновление статуса в реальном времени</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold">{summary.processed} / {summary.total}</div>
          <div className="text-xs text-zinc-400">готово: {summary.done} · ошибок: {summary.failed}</div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-5 space-y-5">
        <section className="max-w-5xl mx-auto rounded-2xl bg-zinc-900 border border-white/10 p-5">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-zinc-300">Общий прогресс треков</span>
            <span className="font-bold">{Math.round(summary.percent)}%</span>
          </div>
          <div className="h-3 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, summary.percent))}%` }} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
            <div><div className="text-zinc-500">Всего</div><div className="font-bold">{summary.total}</div></div>
            <div><div className="text-zinc-500">Готово</div><div className="font-bold text-green-400">{summary.done}</div></div>
            <div><div className="text-zinc-500">Ошибки</div><div className="font-bold text-rose-400">{summary.failed}</div></div>
            <div><div className="text-zinc-500">В очереди</div><div className="font-bold text-zinc-300">{Math.max(0, summary.total - summary.processed)}</div></div>
          </div>
        </section>

        <section className="max-w-5xl mx-auto w-full">
          <h2 className="text-sm font-bold text-zinc-300 mb-2">Текущая загрузка</h2>
          <CurrentDownload task={activeTask} track={currentTrack} />
        </section>

        <section className="max-w-5xl mx-auto w-full">
          <h2 className="text-sm font-bold text-zinc-300 mb-2">Список загрузок</h2>
          <div className="rounded-2xl border border-white/10 overflow-hidden divide-y divide-white/5">
            {tasks.map((task) => {
              const isDone = task.state === 'done';
              const isError = task.state === 'error';
              const progress = isDone ? 100 : Math.max(0, task.progress);
              return (
                <div key={task.task_id} className="p-3 bg-zinc-900/80">
                  <div className="flex items-center gap-3">
                    {isDone ? <Check size={16} className="text-green-400 shrink-0" /> : isError ? <XCircle size={16} className="text-rose-400 shrink-0" /> : task.state === 'retrying' ? <RefreshCw size={16} className="text-amber-400 animate-spin shrink-0" /> : <Loader2 size={16} className="text-green-400 animate-spin shrink-0" />}
                    <span className="font-medium truncate flex-1" title={task.name}>{task.name}</span>
                    <span className={`text-xs shrink-0 ${isError ? 'text-rose-400' : isDone ? 'text-green-400' : 'text-zinc-400'}`}>{stateLabel(task)}</span>
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mt-2">
                    <div className={`h-full rounded-full ${isError ? 'bg-rose-500' : isDone ? 'bg-green-500' : 'bg-emerald-400'}`} style={{ width: `${Math.min(100, progress)}%` }} />
                  </div>
                  <div className="flex justify-between gap-3 mt-1 text-[10px] text-zinc-500">
                    <span>{task.error || `${formatBytes(task.downloaded_bytes)}${task.total_bytes ? ` / ${formatBytes(task.total_bytes)}` : ''}`}</span>
                    <span>{task.eta_secs != null && task.eta_secs >= 0 ? `ETA ${formatEta(task.eta_secs)}` : formatSpeed(task.speed_bps)}</span>
                  </div>
                </div>
              );
            })}
            {queuedTracks.map((track, index) => (
              <div key={`queued-${track.id}-${index}`} className="p-3 bg-zinc-900/50">
                <div className="flex items-center gap-3">
                  <Clock3 size={16} className="text-zinc-500 shrink-0" />
                  <span className="font-medium truncate flex-1" title={`${track.title} — ${track.artist}`}>{track.title} — {track.artist}</span>
                  <span className="text-xs text-zinc-500 shrink-0">В очереди</span>
                </div>
              </div>
            ))}
            {tasks.length === 0 && queuedTracks.length === 0 && pendingCount === 0 && (
              <div className="p-8 text-center text-zinc-500">Загрузок пока нет</div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default DownloadsPanel;