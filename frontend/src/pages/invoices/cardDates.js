/**
 * Original (invoice) subscription window for member cards.
 *
 * The membership card must display the ORIGINAL purchased period exactly as it
 * appears on the paid invoice — NOT the live member.activities dates, which
 * drift when off-schedule attendance pulls the end date back or freezes /
 * closures extend it. (User decision: card == invoice period.)
 */
import { invoicesAPI } from '../../services/api';

/**
 * Fetch a map: activity_id -> { start, end } from the member's PAID invoices.
 * For renewals (several paid invoices per activity) the latest window wins.
 * Returns {} on any failure so callers can fall back to activity dates.
 */
export const fetchOriginalActivityDates = async (memberId) => {
  if (!memberId) return {};
  try {
    const res = await invoicesAPI.getAll({ member_id: memberId, status: 'paid' });
    const map = {};
    (res.data || []).forEach((inv) => {
      if (inv.status !== 'paid') return;
      (inv.items || []).forEach((it) => {
        const aid = it.activity_id;
        if (!aid) return;
        let start = (it.start_date || '').slice(0, 10);
        let end = (it.end_date || '').slice(0, 10);
        if ((!start || !end) && it.period && it.period.includes(' - ')) {
          const [s, e] = it.period.split(' - ');
          start = start || (s || '').trim();
          end = end || (e || '').trim();
        }
        if (!end) return;
        const prev = map[aid];
        if (!prev || end > prev.end) map[aid] = { start, end };
      });
    });
    return map;
  } catch {
    return {};
  }
};

/**
 * Return a copy of the activities array with start/end dates replaced by the
 * original invoice window when available (matched by activity_id).
 */
export const applyOriginalDates = (activities, origMap) =>
  (activities || []).map((a) => {
    const o = a?.activity_id && origMap ? origMap[a.activity_id] : null;
    if (!o) return a;
    return { ...a, start_date: o.start || a.start_date, end_date: o.end || a.end_date };
  });
