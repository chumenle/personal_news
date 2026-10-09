export type NewsPeriod = { start: string; end: string };
export type PeriodChoice = { kind: 'all' } | { kind: 'days'; days: number } | { kind: 'dates'; start: string; end: string };
const dayMs = 86400000;

export function todayInShanghai(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function validatePeriod(period: NewsPeriod, today = todayInShanghai()): NewsPeriod {
  if (!validDate(period.start) || !validDate(period.end)) throw new Error('请选择有效的开始和结束日期。');
  if (period.start > period.end) throw new Error('开始日期不能晚于结束日期。');
  if (period.end > today) throw new Error('结束日期不能晚于今天。');
  if ((Date.parse(period.end) - Date.parse(period.start)) / dayMs >= 30) throw new Error('自定义区间最多为 30 天（含首尾日期）。');
  return period;
}
export function resolvePeriod(choice: PeriodChoice, today = todayInShanghai()): NewsPeriod | null {
  if (choice.kind === 'all') return null;
  if (choice.kind === 'dates') return validatePeriod({ start: choice.start, end: choice.end }, today);
  if (!Number.isInteger(choice.days) || choice.days < 1 || choice.days > 30) throw new Error('请输入 1 到 30 之间的整数天数。');
  return { start: new Date(Date.parse(today + 'T00:00:00Z') - (choice.days - 1) * dayMs).toISOString().slice(0, 10), end: today };
}
export function inPeriod(date: string, period: NewsPeriod | null): boolean {
  return !period || (validDate(date) && date >= period.start && date <= period.end);
}
export function periodQuery(period: NewsPeriod | null): string {
  return period ? '?' + new URLSearchParams(period).toString() : '';
}
export function parsePeriod(params: URLSearchParams): NewsPeriod | null {
  if (!params.has('start') && !params.has('end')) return null;
  return validatePeriod({ start: params.get('start') || '', end: params.get('end') || '' });
}
