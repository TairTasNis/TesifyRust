import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { hourMs, useActivity } from '../../shared/playback/activity/activityStore'
import { useTranslation } from '../../shared/preferences/i18n'
import { usePreferences } from '../../shared/preferences/preferences'
import Icon from '../../shared/ui/Icon/Icon'
import { activityPeriod, bucketLabel, dateInputValue, periods } from './activityPeriods'
import type { CustomRange, Period } from './activityPeriods'
import './ListeningStats.css'

const periodLabels: Record<Period, string> = {
  day: 'День', week: 'Неделя', month: 'Месяц', year: 'Год', all: 'Всё время', custom: 'Свой период',
}

const todayValue = () => dateInputValue(new Date())

export default function ListeningStats() {
  const t = useTranslation()
  const { language } = usePreferences()
  const history = useActivity()
  const [today, setToday] = useState(todayValue)
  const [period, setPeriod] = useState<Period>('day')
  const [custom, setCustom] = useState<CustomRange>(() => ({ from: today, to: today }))
  const [inspected, setInspected] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const statistics = useMemo(() => activityPeriod(history, period, today, custom), [history, period, today, custom])
  const { plainNumber, hours } = useMemo(() => ({
    plainNumber: new Intl.NumberFormat(language, { maximumFractionDigits: 2 }),
    hours: new Intl.NumberFormat(language, { style: 'unit', unit: 'hour', maximumFractionDigits: 2 }),
  }), [language])

  useEffect(() => {
    const update = () => setToday(todayValue())
    const timer = window.setInterval(update, 30_000)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  function selectPeriod(value: Period) {
    setPeriod(value)
    setInspected(null)
    setSelected(null)
  }

  function setDate(field: keyof CustomRange, value: string) {
    setCustom(current => ({ ...current, [field]: value }))
    setInspected(null)
    setSelected(null)
  }

  const buckets = statistics?.buckets ?? []
  const active = buckets.find(bucket => bucket.start === (inspected ?? selected))
  const peak = Math.max(0, ...buckets.map(bucket => bucket.listeningMs / hourMs))
  const ceiling = peak < 1 ? Math.max(.25, Math.ceil(peak * 4) / 4) : Math.ceil(peak)
  const axisIndices = [...new Set([0, Math.round((buckets.length - 1) / 2), buckets.length - 1])]
  return <section className="listening-stats" aria-labelledby="listening-heading">
    <header className="listening-stats-heading">
      <h2 id="listening-heading">{t('Статистика прослушивания')}</h2>
      <select aria-label={t('Период')} value={period} onChange={event => selectPeriod(event.currentTarget.value as Period)}>
        {periods.map(value => <option key={value} value={value}>{t(periodLabels[value])}</option>)}
      </select>
    </header>
    {period === 'custom' && <div className="listening-dates">
      <label>{t('С даты')}<input type="date" max={today} value={custom.from} onChange={event => setDate('from', event.currentTarget.value)} /></label>
      <label>{t('По дату')}<input type="date" max={today} value={custom.to} onChange={event => setDate('to', event.currentTarget.value)} /></label>
    </div>}
    {!statistics ? <p className="listening-invalid" role="status">{t('Укажите корректный диапазон дат.')}</p> : <>
      <div className="listening-totals">
        <div className="listening-card">
          <span>{t(period === 'day' ? 'Заходы за день' : 'Заходы в приложение')}<Icon name="home" /></span>
          <output>{plainNumber.format(statistics.totals.visits)}</output>
        </div>
        <div className="listening-card">
          <span>{t('Прослушано треков')}<Icon name="play" /></span>
          <output>{plainNumber.format(statistics.totals.tracks)}</output>
        </div>
      </div>
      <figure className="listening-chart">
        <figcaption>
          <div><h3>{t('Время прослушивания')}</h3><output>{hours.format(statistics.totals.listeningMs / hourMs)}</output></div>
          {active && <div className="listening-chart-detail">
            <span>{bucketLabel(active, statistics.granularity, language)}</span>
            <strong>{hours.format(active.listeningMs / hourMs)}</strong>
          </div>}
        </figcaption>
        <div className="listening-chart-plot">
          <div className="listening-chart-scale" aria-hidden="true">
            {[ceiling, ceiling / 2, 0].map(value => <span key={value}>{plainNumber.format(value)}</span>)}
          </div>
          <div className="listening-chart-bars" style={{ '--bucket-count': buckets.length } as CSSProperties}>
            {buckets.map(bucket => <button type="button" key={bucket.start}
              aria-label={`${bucketLabel(bucket, statistics.granularity, language)}, ${hours.format(bucket.listeningMs / hourMs)}`}
              aria-pressed={selected === bucket.start}
              data-highlighted={active?.start === bucket.start || undefined}
              onPointerEnter={event => { if (event.pointerType === 'mouse') setInspected(bucket.start) }}
              onPointerLeave={() => setInspected(null)}
              onFocus={() => setInspected(bucket.start)} onBlur={() => setInspected(null)}
              onClick={() => { setInspected(null); setSelected(current => current === bucket.start ? null : bucket.start) }}>
              <span style={{ '--bar-height': `${Math.max(bucket.listeningMs ? 1 : 0, 100 * bucket.listeningMs / (ceiling * hourMs))}%` } as CSSProperties} />
            </button>)}
          </div>
          <div className="listening-chart-axis" aria-hidden="true">
            {axisIndices.map(index => <span key={index}>{bucketLabel(buckets[index], statistics.granularity, language, true)}</span>)}
          </div>
        </div>
      </figure>
    </>}
  </section>
}
