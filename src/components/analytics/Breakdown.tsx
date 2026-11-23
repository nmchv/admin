import { useAsync } from '@/hooks/useAsync';
import { fetchBreakdown } from '@/lib/supabase/api';
import { BarList } from './BarList';
import type { Range } from '@/utils/format';
import type { BreakdownDim } from '@/types';

const SOURCE_LABELS: Record<string, string> = {
  direct: 'Прямые переходы',
  search: 'Поисковые системы',
  external: 'Внешние сайты',
  social: 'Социальные сети',
  other: 'Другие источники',
};
const DEVICE_LABELS: Record<string, string> = {
  desktop: 'Desktop',
  mobile: 'Mobile',
  tablet: 'Tablet',
  other: 'Другое',
};

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['ru'], { type: 'region' });
  } catch {
    return null;
  }
})();

function labelFor(dim: BreakdownDim, raw: string): string {
  switch (dim) {
    case 'source':
      return SOURCE_LABELS[raw] ?? raw;
    case 'device':
      return DEVICE_LABELS[raw] ?? raw;
    case 'country':
      try {
        return regionNames?.of(raw) ?? raw;
      } catch {
        return raw;
      }
    default:
      return raw === 'Unknown' || raw === 'Other' ? 'Другое' : raw;
  }
}

const META: Record<BreakdownDim, { title: string; subtitle: string; emptyHint?: string }> = {
  source: { title: 'Источники трафика', subtitle: 'Сессии по источнику перехода' },
  device: { title: 'Устройства', subtitle: 'Уникальные посетители' },
  os: { title: 'Операционные системы', subtitle: 'Уникальные посетители' },
  browser: { title: 'Браузеры', subtitle: 'Уникальные посетители' },
  country: {
    title: 'География',
    subtitle: 'Уникальные посетители по странам (приблизительно)',
    emptyHint:
      'Страна определяется по заголовку CDN запроса и может быть недоступна. Точные координаты и IP не собираются.',
  },
};

interface Props {
  dim: BreakdownDim;
  range: Range;
  serviceId: string | null;
  nonce: number;
}

export function Breakdown({ dim, range, serviceId, nonce }: Props) {
  const { data, loading, error, reload } = useAsync(
    () => fetchBreakdown(range.from, range.to, dim, serviceId),
    [range.from.getTime(), range.to.getTime(), dim, serviceId, nonce],
  );
  const m = META[dim];

  return (
    <BarList
      title={m.title}
      subtitle={m.subtitle}
      emptyHint={m.emptyHint}
      loading={loading}
      error={error}
      onRetry={reload}
      items={(data ?? []).map((r) => ({ key: r.label, label: labelFor(dim, r.label), value: r.visitors }))}
    />
  );
}
