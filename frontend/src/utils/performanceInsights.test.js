import { assessmentEvidence, automaticPerformanceReport, movementCandidates, qualitySegments, qualitySummary, sportTiming, swimmerAssessmentSummary } from './performanceInsights';

test('quality map exposes unscanned and lost intervals without hiding uncertainty', () => {
  const samples = [{ time: 1, quality: 'valid' }, { time: 1.1, quality: 'lost' }, { time: 5, quality: 'unreliable' }];
  expect(qualitySummary(samples)).toMatchObject({ valid: 1, lost: 1, unreliable: 1, percentage: 33 });
  expect(qualitySegments(samples, 10, 10).map(segment => segment.quality)).toEqual([
    'unscanned', 'lost', 'unscanned', 'unscanned', 'unscanned', 'unreliable', 'unscanned', 'unscanned', 'unscanned', 'unscanned',
  ]);
});

test('swimming cycle rate requires repeated coach-reviewed markers', () => {
  const labels = ['بداية السحبة', 'خروج الذراع', 'الدفع بالرجل'];
  const result = sportTiming([
    { time: 1, label: labels[0] }, { time: 1.7, label: labels[1] }, { time: 2.1, label: labels[2] }, { time: 3, label: labels[0] },
  ], 'swimming', 'swimming_freestyle', labels);
  expect(result.phases[0]).toEqual({ label: 'متوسط دورة الحركة', seconds: 2 });
  expect(result.phases[1]).toEqual({ label: 'معدل الدورات في الدقيقة', count: 30 });
});

test('football timing reports no invented ball contact', () => {
  const labels = ['الاقتراب', 'ملامسة الكرة', 'متابعة القدم'];
  expect(sportTiming([{ time: 1, label: labels[0] }], 'football', 'football_shot', labels).phases).toEqual([]);
  expect(sportTiming([{ time: 1, label: labels[0] }, { time: 1.4, label: labels[1] }], 'football', 'football_shot', labels).phases[0].seconds).toBeCloseTo(0.4);
});

test('movement suggestions require a real local angle minimum across contiguous valid samples', () => {
  const samples = [140, 105, 139].map((angle, index) => ({ time: index * 0.25, quality: 'valid', metrics: { elbow_angle: angle } }));
  expect(movementCandidates(samples, 'swimming')).toEqual([{ time: 0.25, angle: 105, metric: 'elbow_angle' }]);
  samples[1].quality = 'lost';
  expect(movementCandidates(samples, 'swimming')).toEqual([]);
});

test('automatic report uses valid observed angles and discloses tracking gaps', () => {
  const samples = [
    { time: 0, quality: 'valid', metrics: { elbow_angle: 100 } },
    { time: 0.25, quality: 'lost', metrics: { elbow_angle: 5 } },
    { time: 0.5, quality: 'valid', metrics: { elbow_angle: 120 } },
    { time: 0.75, quality: 'valid', metrics: { elbow_angle: 110 } },
  ];
  const report = automaticPerformanceReport(samples, 'swimming', 2);
  expect(report.ready).toBe(true);
  expect(report.lines.join(' ')).toContain('100° و120°');
  expect(report.lines.join(' ')).not.toContain('5°');
  expect(report.lines.join(' ')).toContain('فُقد فيها التتبّع');
  expect(automaticPerformanceReport([], 'football', 2).ready).toBe(false);
});

test('swimmer assessment never turns weak tracking into an automatic verdict', () => {
  const assessment = { strengths: 'ثبات وضع الرأس', priorities: [{ observed: 'دخول اليد مبكرًا', target: 'دخول اليد أمام الكتف', priority: 'high', exercise: 'تمرين ذراع واحدة', marker_time: 2.5 }] };
  const samples = [{ time: 2.5, quality: 'valid', metrics: { elbow_angle: 120 } }];
  expect(assessmentEvidence(samples).adequate).toBe(false);
  const summary = swimmerAssessmentSummary(assessment, samples);
  expect(summary).toContain('لا تكفي لحكم آلي نهائي');
  expect(summary).toContain('تمرين ذراع واحدة');
  expect(swimmerAssessmentSummary({ strengths: '', priorities: [] }, samples)).toBe('');
});
