export const SKILLS = {
  swimming: [
    ['swimming_freestyle', 'سباحة حرة'], ['swimming_backstroke', 'سباحة ظهر'],
    ['swimming_breaststroke', 'سباحة صدر'], ['swimming_butterfly', 'سباحة فراشة'],
  ],
  football: [
    ['football_shot', 'تسديد'], ['football_pass', 'تمرير'],
    ['football_dribble', 'مراوغة'], ['football_run', 'جري'],
  ],
};

export const MOMENT_LABELS = {
  swimming_freestyle: ['بداية السحبة', 'خروج الذراع', 'الدفع بالرجل'],
  swimming_backstroke: ['دخول اليد', 'السحبة', 'الدفع بالرجل'],
  swimming_breaststroke: ['فتح الذراعين', 'ضم الرجلين', 'الانزلاق'],
  swimming_butterfly: ['دخول الذراعين', 'السحبة', 'ركلة الدولفين'],
  football_shot: ['الاقتراب', 'ملامسة الكرة', 'متابعة القدم'],
  football_pass: ['الاستعداد', 'ملامسة الكرة', 'المتابعة'],
  football_dribble: ['لمسة الكرة', 'تغيير الاتجاه', 'التسارع'],
  football_run: ['ملامسة الأرض', 'دفع القدم', 'مرحلة الطيران'],
  general: ['البداية', 'لحظة الحركة', 'النهاية'],
};

export const skillLabel = skill => Object.values(SKILLS).flat().find(([key]) => key === skill)?.[1] || 'مهارة عامة';

export const metricLabel = key => ({
  elbow_angle: 'زاوية المرفق', knee_angle: 'زاوية الركبة',
  hip_angle: 'زاوية الورك', body_tilt: 'ميل الجذع',
}[key] || key);

const primary = sport => sport === 'football' ? ['knee_angle', 'hip_angle'] : ['elbow_angle', 'hip_angle'];
const finite = value => typeof value === 'number' && Number.isFinite(value);

export const eventSummary = (samples, anchor, sport) => {
  const buckets = new Map();
  for (const sample of samples || []) {
    if (Math.abs(sample.time - anchor) <= 1) buckets.set(Math.round(sample.time * 4), sample);
  }
  const valid = [...buckets.values()].filter(sample => sample.quality === 'valid' &&
    primary(sport).every(key => finite(sample.metrics?.[key])));
  const coverage = Math.min(1, valid.length / 8);
  const values = {};
  for (const key of [...primary(sport), 'body_tilt']) {
    const numbers = valid.map(sample => sample.metrics?.[key]).filter(finite).sort((a, b) => a - b);
    if (numbers.length) {
      const middle = Math.floor(numbers.length / 2);
      values[key] = Math.round((numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2) * 10) / 10;
    }
  }
  return { coverage, validSamples: valid.length, sampledFrames: buckets.size,
    values, usable: coverage >= 0.6 && valid.length >= 5 };
};

export const comparisonReport = (currentSamples, baselineSamples, comparison, sport) => {
  if (!comparison) return null;
  const before = eventSummary(baselineSamples, comparison.baseline_event_time, sport);
  const after = eventSummary(currentSamples, comparison.current_event_time, sport);
  const deltas = Object.fromEntries(Object.entries(after.values)
    .filter(([key]) => finite(before.values[key]))
    .map(([key, value]) => [key, Math.round((value - before.values[key]) * 10) / 10]));
  return { before, after, deltas, usable: before.usable && after.usable };
};

export const chartPoints = (samples, anchor, metric) => (samples || [])
  .filter(sample => sample.quality === 'valid' && finite(sample.metrics?.[metric]) && Math.abs(sample.time - anchor) <= 2)
  .sort((a, b) => a.time - b.time)
  .map(sample => ({ x: sample.time - anchor, y: sample.metrics[metric] }));
