import { Hourglass } from 'lucide-react';

/** Честная заглушка: раздел ещё не реализован, и это явно сказано пользователю. */
export default function Planned({ title, stage, items }: { title: string; stage: string; items: string[] }) {
  return (
    <div className="card mx-auto mt-6 max-w-xl p-8 text-center">
      <Hourglass className="mx-auto h-7 w-7 text-muted" />
      <h2 className="mt-4 text-lg font-extrabold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted">Раздел запланирован — {stage}. Сейчас здесь нет данных и действий.</p>
      <ul className="mx-auto mt-5 max-w-sm space-y-1.5 text-left text-sm text-muted">
        {items.map((i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted" />
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}
