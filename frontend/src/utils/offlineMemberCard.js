import QRCode from 'qrcode';
import { getMemberQRValue } from './memberQR';

export const offlineCardKey = (tenant, memberId) => memberId ? `member_offline_card_v1:${tenant}:${memberId}` : '';

export function readOfflineCard(tenant, memberId) {
  const key = offlineCardKey(tenant, memberId);
  if (!key) return null;
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value?.data && value?.savedAt ? value : null;
  } catch { return null; }
}

export async function saveOfflineCard(tenant, memberId, data) {
  const key = offlineCardKey(tenant, memberId);
  if (!key) return null;
  const cards = data.cards?.length ? data.cards : [data];
  const qr = {};
  for (const card of cards) {
    if (card.member_code) qr[card.member_code] = await QRCode.toString(getMemberQRValue(card.member_code), { type: 'svg', margin: 2 });
  }
  const value = { data, qr, savedAt: new Date().toISOString() };
  try { localStorage.setItem(key, JSON.stringify(value)); return value; }
  catch { return null; }
}

export function clearOfflineCards() {
  for (let index = localStorage.length - 1; index >= 0; index--) {
    const key = localStorage.key(index);
    if (key?.startsWith('member_offline_card_v1:')) localStorage.removeItem(key);
  }
}
