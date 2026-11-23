import { useMemo, useState } from 'react';
import { resolveRange } from '@/utils/format';
import type { Period } from '@/types';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: '7d', label: '7 дней' },
  { key: '30d', label: '30 дней' },
  { key: '90d', label: '90 дней' },
  { key: '12m', label: '12 месяцев' },
  { key: 'custom', label: 'Период' },
];

const ymd = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/**
 * Состояние выбранного периода. range пересчитывается при смене периода/дат и при refresh(),
 * nonce меняется при каждом refresh() — его можно добавлять в зависимости загрузки данных.
 */
export function useRangeState(initial: Period = '7d') {
  const [period, setPeriod] = useState<Period>(initial);
  const [custom, setCustom] = useState(() => ({
    from: ymd(new Date(Date.now() - 7 * 86_400_000)),
    to: ymd(new Date()),
  }));
  const [nonce, setNonce] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const range = useMemo(() => resolveRange(period, custom), [period, custom, nonce]);
  return { period, setPeriod, custom, setCustom, range, nonce, refresh: () => setNonce((n) => n + 1) };
}

interface Props {
  period: Period;
  onPeriod: (p: Period) => void;
  custom: { from: string; to: string };
  onCustom: (c: { from: string; to: string }) => void;
}

export function PeriodPicker({ period, onPeriod, custom, onCustom }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap rounded-xl border border-line bg-surface p-0.5">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => onPeriod(p.key)}
            className={`rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-colors ${
              period === p.key ? 'bg-elevated text-fg' : 'text-muted hover:text-fg'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="input !w-auto !py-1.5"
            value={custom.from}
            max={custom.to}
            onChange={(e) => e.target.value && onCustom({ ...custom, from: e.target.value })}
            aria-label="Начало периода"
          />
          <span className="text-muted">—</span>
          <input
            type="date"
            className="input !w-auto !py-1.5"
            value={custom.to}
            min={custom.from}
            max={ymd(new Date())}
            onChange={(e) => e.target.value && onCustom({ ...custom, to: e.target.value })}
            aria-label="Конец периода"
          />
        </div>
      )}
    </div>
  );
}
