const dateKey = date => date.toISOString().slice(0, 10);
export const riyadhDate = date => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};

export const riyadhMonth = (now = new Date()) => riyadhDate(now).slice(0, 7);

export const shiftMonth = (month, offset) => {
  const [year, number] = month.split('-').map(Number);
  return dateKey(new Date(Date.UTC(year, number - 1 + offset, 1))).slice(0, 7);
};

export function campaignCalendar(rows, month) {
  const [year, number] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const result = Array.from({ length: days }, (_, index) => ({
    date: dateKey(new Date(Date.UTC(year, number - 1, index + 1))),
    campaigns: [], approved: 0, awaiting: 0,
  }));
  const byDate = new Map(result.map(day => [day.date, day]));
  for (const row of rows || []) {
    if (row.status === 'cancelled') continue;
    const pending = row.status === 'pending_review';
    const add = (date, count) => {
      const day = byDate.get(date);
      if (!day || count < 1) return;
      day.campaigns.push({ id: row.id, title: row.title, count, pending, status: row.status });
      day[pending ? 'awaiting' : 'approved'] += count;
    };
    const total = Number(row.count) || 0;
    const daily = Number(row.daily_recipients) || 0;
    if (daily > 0 && /^\d{4}-\d{2}-\d{2}$/.test(row.start_date || '')) {
      const start = new Date(`${row.start_date}T00:00:00Z`);
      if (Number.isNaN(start.getTime())) continue;
      for (let index = 0; index < Math.ceil(total / daily); index++) {
        add(dateKey(new Date(start.getTime() + index * 86400000)), Math.min(daily, total - index * daily));
      }
    } else if (row.schedule_at) {
      const date = new Date(row.schedule_at);
      if (!Number.isNaN(date.getTime())) {
        add(riyadhDate(date), total);
      }
    }
  }
  return result;
}
