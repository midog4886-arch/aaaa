import { qualitySegments, qualitySummary, sportTiming } from './performanceInsights';

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
