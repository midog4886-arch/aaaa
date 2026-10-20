const finite = value => typeof value === 'number' && Number.isFinite(value);

export const qualitySummary = samples => {
  const counts = { valid: 0, lost: 0, unreliable: 0 };
  for (const sample of samples || []) {
    if (sample.quality in counts) counts[sample.quality] += 1;
  }
  const total = counts.valid + counts.lost + counts.unreliable;
  return { ...counts, total, percentage: total ? Math.round(counts.valid / total * 100) : 0 };
};

export const qualitySegments = (samples, duration, count = 60) => {
  if (!finite(duration) || duration <= 0) return [];
  const segments = Array.from({ length: count }, (_, index) => ({ index, time: index * duration / count, quality: 'unscanned' }));
  for (const sample of samples || []) {
    if (!finite(sample.time) || sample.time < 0 || sample.time > duration) continue;
    const segment = segments[Math.min(count - 1, Math.floor(sample.time / duration * count))];
    // A doubtful frame must never be hidden by a good frame in the same segment.
    const rank = { unscanned: 0, valid: 1, unreliable: 2, lost: 3 };
    if ((rank[sample.quality] || 0) > rank[segment.quality]) segment.quality = sample.quality;
  }
  return segments;
};

const markerTimes = (markers, label) => (markers || [])
  .filter(marker => marker.label === label && finite(marker.time))
  .map(marker => marker.time).sort((a, b) => a - b);

export const sportTiming = (markers, sport, skill, labels) => {
  const [start, middle, end] = labels || [];
  const starts = markerTimes(markers, start);
  const middles = markerTimes(markers, middle);
  const ends = markerTimes(markers, end);
  const cycles = starts.slice(1).map((time, index) => time - starts[index]).filter(value => value > 0.1);
  const averageCycle = cycles.length ? cycles.reduce((sum, value) => sum + value, 0) / cycles.length : null;
  const phases = [];
  if (sport === 'swimming') {
    if (averageCycle) phases.push({ label: 'متوسط دورة الحركة', seconds: averageCycle });
    if (averageCycle) phases.push({ label: 'معدل الدورات في الدقيقة', count: Math.round(60 / averageCycle * 10) / 10 });
  } else if (sport === 'football' && starts.length && middles.length) {
    const contact = middles.find(time => time > starts[0]);
    if (finite(contact)) phases.push({ label: 'من الاستعداد إلى ملامسة الكرة', seconds: contact - starts[0] });
  }
  if (middles.length && ends.length) {
    const finish = ends.find(time => time > middles[0]);
    if (finite(finish)) phases.push({ label: sport === 'swimming' ? 'من السحبة إلى المرحلة التالية' : 'من ملامسة الكرة إلى المتابعة', seconds: finish - middles[0] });
  }
  return { phases, eventCount: starts.length + middles.length + ends.length, skill };
};

// Candidates are only navigation aids. A minimum joint angle is not proof of
// ball contact, a swimming stroke phase, or good technique.
export const movementCandidates = (samples, sport, minimumGap = 0.65) => {
  const key = sport === 'football' ? 'knee_angle' : 'elbow_angle';
  const valid = (samples || []).filter(sample => sample.quality === 'valid' && finite(sample.metrics?.[key]))
    .sort((a, b) => a.time - b.time);
  const candidates = [];
  for (let index = 1; index < valid.length - 1; index += 1) {
    const before = valid[index - 1], current = valid[index], after = valid[index + 1];
    if (current.time - before.time > 0.4 || after.time - current.time > 0.4) continue;
    if (current.metrics[key] > before.metrics[key] - 8 || current.metrics[key] > after.metrics[key] - 8) continue;
    if (candidates.length && current.time - candidates[candidates.length - 1].time < minimumGap) continue;
    candidates.push({ time: current.time, angle: current.metrics[key], metric: key });
  }
  return candidates.slice(0, 12);
};
