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

// A descriptive report from observed frames only. No technique score or diagnosis is inferred.
export const automaticPerformanceReport = (samples, sport, duration, language = 'ar') => {
  const ar = language === 'ar';
  const ordered = (samples || []).filter(sample => finite(sample.time)).sort((a, b) => a.time - b.time);
  const quality = qualitySummary(ordered);
  const valid = ordered.filter(sample => sample.quality === 'valid');
  const scannedSeconds = ordered.length > 1 ? Math.max(0, ordered[ordered.length - 1].time - ordered[0].time) : 0;
  const coverage = finite(duration) && duration > 0 ? Math.min(100, Math.round(scannedSeconds / duration * 100)) : null;
  const keys = sport === 'football' ? ['knee_angle', 'hip_angle', 'body_tilt'] : ['elbow_angle', 'hip_angle', 'body_tilt'];
  const names = ar ? { knee_angle: 'الركبة', elbow_angle: 'المرفق', hip_angle: 'الورك', body_tilt: 'ميل الجذع' }
    : { knee_angle: 'Knee', elbow_angle: 'Elbow', hip_angle: 'Hip', body_tilt: 'Trunk tilt' };
  const lines = [];
  if (!quality.total) return { ready: false, lines: [ar ? 'لم يبدأ تحليل الفيديو بعد؛ شغّل تتبّع المفاصل وشاهد المقطع.' : 'No frames analyzed yet. Start pose tracking and play the video.'], quality, coverage };
  lines.push(ar ? `فُحصت ${quality.total} لقطة؛ ${quality.valid} صالحة (${quality.percentage}%)، ${quality.unreliable} غير واضحة، و${quality.lost} فُقد فيها التتبّع.`
    : `${quality.total} frames analyzed: ${quality.valid} valid (${quality.percentage}%), ${quality.unreliable} unclear, ${quality.lost} lost.`);
  if (coverage !== null) lines.push(ar ? `امتدت العينات عبر نحو ${coverage}% من مدة الفيديو؛ هذا ليس دليلًا على فحص كل إطار بينهما.`
    : `Samples span about ${coverage}% of the video duration; intervening frames may be unscanned.`);
  for (const key of keys) {
    const values = valid.map(sample => sample.metrics?.[key]).filter(finite);
    if (values.length < 3) continue;
    const min = Math.round(Math.min(...values));
    const max = Math.round(Math.max(...values));
    lines.push(ar ? `${names[key]}: تراوحت الزاوية بين ${min}° و${max}° في ${values.length} قياسات صالحة.`
      : `${names[key]} angle ranged from ${min}° to ${max}° across ${values.length} valid measurements.`);
  }
  if (valid.length < 3) lines.push(ar ? 'القياسات الصالحة غير كافية لاستخراج نطاق زوايا موثوق؛ أعد التصوير بوضوح أكبر.'
    : 'Too few valid measurements for a reliable angle range. Record a clearer view.');
  lines.push(ar ? 'هذه ملاحظات آلية تقريبية من كاميرا واحدة، وليست تقييمًا فنيًا أو تشخيصًا. راجع اللقطات غير الواضحة قبل اعتماد التقرير.'
    : 'These are approximate single-camera observations, not a technique assessment or diagnosis. Review unclear frames before approval.');
  return { ready: true, lines, quality, coverage };
};
