'use client';
import { useId, useState } from 'react';
import { resolvePeriod, todayInShanghai, type PeriodChoice } from '@/lib/news-period';

export default function PeriodPicker({ value, onChange, disabled = false }: {
  value: PeriodChoice; onChange: (value: PeriodChoice) => void; disabled?: boolean;
}) {
  const id = useId(), today = todayInShanghai();
  const [custom, setCustom] = useState(false), [mode, setMode] = useState('days');
  const [days, setDays] = useState('7'), [start, setStart] = useState(today), [end, setEnd] = useState(today);
  const [error, setError] = useState('');
  const period = resolvePeriod(value, today);
  const isCustom = value.kind === 'dates' || (value.kind === 'days' && ![1, 7, 30].includes(value.days));
  function choose(next: PeriodChoice) { setError(''); setCustom(false); onChange(next); }
  return <section className="period-picker" aria-label="报纸时间区间">
    <div className="period-presets"><strong>时间区间</strong>
      <button type="button" disabled={disabled} aria-pressed={value.kind === 'all'} onClick={() => choose({ kind: 'all' })}>全部</button>
      {[1, 7, 30].map(n => <button type="button" disabled={disabled} key={n} aria-pressed={value.kind === 'days' && value.days === n} onClick={() => choose({ kind: 'days', days: n })}>过去 {n} 天</button>)}
      <button type="button" disabled={disabled} aria-pressed={isCustom} aria-expanded={custom} aria-controls={id} onClick={() => { setCustom(!custom); setError(''); }}>自定义</button>
    </div>
    <p className="period-summary" role="status">{period ? `当前区间：${period.start} 至 ${period.end}（含首尾）` : '当前区间：全部日期'} · 按北京时间计算，过去 N 天包含今天。</p>
    {custom && <form id={id} className="period-custom" onSubmit={e => {
      e.preventDefault();
      const next: PeriodChoice = mode === 'days' ? { kind: 'days', days: Number(days) } : { kind: 'dates', start, end };
      try { resolvePeriod(next, today); choose(next); } catch (e) { setError(e instanceof Error ? e.message : '请检查时间区间。'); }
    }}>
      <fieldset disabled={disabled}><legend>自定义时间区间（1–30 天）</legend>
        <label>自定义方式<select value={mode} onChange={e => { setMode(e.target.value); setError(''); }}><option value="days">过去天数</option><option value="dates">起止日期</option></select></label>
        {mode === 'days' ? <label>过去多少天<input type="number" required min={1} max={30} step={1} value={days} onChange={e => setDays(e.target.value)} /></label> : <>
          <label>开始日期<input type="date" required max={today} value={start} onChange={e => setStart(e.target.value)} /></label>
          <label>结束日期<input type="date" required max={today} value={end} onChange={e => setEnd(e.target.value)} /></label>
        </>}
        <button className="primary" type="submit">应用区间</button>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>}
  </section>;
}
