import { createGuestPerformanceReviews } from './guestPerformanceReviews';

test('guest reviews stay within their page session and retain detailed annotations', async () => {
  const firstPage = createGuestPerformanceReviews();
  const { data: created } = await firstPage.createLocal('guest', {
    title: 'لقطة سباحة', sport: 'swimming', skill: 'swimming_freestyle',
  });
  const { data: updated } = await firstPage.update(created.id, {
    coach_summary: 'مراجعة وضع الذراع',
    markers: [{ time: 1.2, label: 'بداية السحبة', note: 'تصحيح المرفق', corrected_points: { 14: { x: 0.4, y: 0.5 } } }],
    samples: [{ time: 1.25, quality: 'valid', seen: 20, metrics: { elbow_angle: 140 } }],
  });
  expect(updated.markers[0].corrected_points['14']).toEqual({ x: 0.4, y: 0.5 });
  expect((await firstPage.list()).data).toHaveLength(1);
  expect((await createGuestPerformanceReviews().list()).data).toHaveLength(0);
  await firstPage.delete(created.id);
  expect((await firstPage.list()).data).toHaveLength(0);
});
