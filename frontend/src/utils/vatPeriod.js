export const vatPresetRange = (preset, today = new Date()) => {
  const year = today.getFullYear();
  const month = today.getMonth();
  const format = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  if (preset === 'all') return { start: '', end: '' };
  if (preset === 'month') return { start: format(new Date(year, month, 1)), end: format(new Date(year, month + 1, 0)) };
  if (preset === 'previous-month') return { start: format(new Date(year, month - 1, 1)), end: format(new Date(year, month, 0)) };
  const quarterStart = Math.floor(month / 3) * 3;
  return { start: format(new Date(year, quarterStart, 1)), end: format(new Date(year, quarterStart + 3, 0)) };
};
