import { saveOfflineCard, readOfflineCard, clearOfflineCards } from '../offlineMemberCard';

afterEach(() => localStorage.clear());

test('offline cards contain usable SVG QR and stay scoped to account and academy', async () => {
  const saved = await saveOfflineCard('academy-one', 'member-one', { member_code: 'ACA-123', name_ar: 'عضو' });
  expect(saved.qr['ACA-123']).toContain('<svg');
  expect(readOfflineCard('academy-one', 'member-one').data.member_code).toBe('ACA-123');
  expect(readOfflineCard('academy-two', 'member-one')).toBeNull();
  expect(readOfflineCard('academy-one', 'member-two')).toBeNull();
  expect(readOfflineCard('academy-one', null)).toBeNull();
});

test('logout removes all saved membership cards but preserves unrelated storage', async () => {
  await saveOfflineCard('one', 'm1', { member_code: 'A' });
  await saveOfflineCard('two', 'm2', { member_code: 'B' });
  localStorage.setItem('other', 'keep');
  clearOfflineCards();
  expect(readOfflineCard('one', 'm1')).toBeNull();
  expect(readOfflineCard('two', 'm2')).toBeNull();
  expect(localStorage.getItem('other')).toBe('keep');
});
