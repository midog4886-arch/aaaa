import { buildPermanentMemberCardHtml, openPermanentMemberCardPrint } from '../permanentMemberCard';

jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => require('react').createElement('svg', { 'data-qr-value': value }),
}));

describe('permanent membership card template', () => {
  const member = {
    id: 'member-id-9',
    member_code: '  M-001  ',
    name_ar: '<عضو & شريك>',
    photo_url: 'https://example.test/member.jpg',
    activities: [{ start_date: '2024-01-01', end_date: '2024-02-01', schedule: 'Sunday' }],
  };

  test('prints one standard-size reusable card with identity and QR', () => {
    const html = buildPermanentMemberCardHtml({
      member,
      qrValue: '  M-001  ',
      logoUrl: 'https://example.test/logo.png',
      academyName: 'Academy <One>',
    });

    expect(html).toContain('@page { size: 54mm 85.6mm; margin: 0; }');
    expect(html).toContain('class="card front"');
    expect(html).toContain('class="card back"');
    expect(html).toContain('data-qr-value="  M-001  "');
    expect(html).toContain('<svg');
    expect(html).not.toContain('api.qrserver.com');
    expect(html).toContain('&lt;عضو &amp; شريك&gt;');
    expect(html).toContain('Academy &lt;One&gt;');
    expect(html).toContain('https://example.test/logo.png');
  });

  test('does not include mutable membership information or the member photo', () => {
    const html = buildPermanentMemberCardHtml({
      member,
      qrValue: member.member_code,
      logoUrl: 'https://example.test/logo.png',
      academyName: 'Academy',
    });

    expect(html).not.toContain('member.jpg');
    expect(html).not.toContain('2024-01-01');
    expect(html).not.toContain('2024-02-01');
    expect(html).not.toContain('Sunday');
    expect(html).not.toContain('logo-card');
  });

  test('returns null when the browser blocks the popup', () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null);

    expect(openPermanentMemberCardPrint({ member, qrValue: member.member_code })).toBeNull();

    open.mockRestore();
  });

  test('back uses the member branch contact, never the personal phone', () => {
    const html = buildPermanentMemberCardHtml({
      member: { ...member, branch_name: 'Branch A', branch_phone: 'BRANCH-PHONE', phone: 'PERSONAL-PHONE' },
      qrValue: member.member_code,
    });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('.card')).toHaveLength(2);
    expect(doc.querySelector('.back').textContent).not.toContain('Branch A');
    expect(doc.querySelector('.branch-name')).toBeNull();
    expect(html).toContain('width: 49mm; height: 60mm; object-fit: contain');
    expect(doc.querySelector('.back').textContent).toContain('BRANCH-PHONE');
    expect(doc.querySelector('.back').textContent).not.toContain('PERSONAL-PHONE');
    expect(doc.querySelector('.front').textContent).toContain('PERSONAL-PHONE');
    expect(doc.querySelector('.back-logo')).not.toBeNull();
  });

  test('missing branch contact is explicit; scoped override uses the selected member branch', () => {
    const missing = buildPermanentMemberCardHtml({ member, qrValue: member.member_code });
    expect(missing).toContain('رقم الفرع غير مسجل');
    const html = buildPermanentMemberCardHtml({
      member, qrValue: member.member_code, branchName: 'Branch B', branchPhone: 'B-PHONE',
    });
    expect(html).not.toContain('Branch B');
    expect(html).toContain('B-PHONE');
  });

  test('front shows distinct activity names and guardian contact without subscription dates', () => {
    const html = buildPermanentMemberCardHtml({
      member: {
        ...member, guardian_phone: 'GUARDIAN', phone: 'OTHER-CONTACT',
        activities: [
          { activity_name: 'Swimming <junior>', start_date: '2024-01-01' },
          { activity_name: 'Swimming <junior>' },
          { activity_name: 'Karate' },
        ],
      },
      qrValue: member.member_code,
    });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('.activity-names').textContent).toBe('Swimming <junior> • Karate');
    expect(doc.querySelector('.guardian-phone').textContent).toBe('GUARDIAN');
    expect(html).not.toContain('OTHER-CONTACT');
    expect(html).not.toContain('2024-01-01');
    expect(html).toContain('&lt;junior&gt;');
  });

  test('does not open a print window when a QR payload is unavailable', () => {
    const open = jest.spyOn(window, 'open');

    expect(openPermanentMemberCardPrint({ member, qrValue: '' })).toBeNull();
    expect(open).not.toHaveBeenCalled();

    open.mockRestore();
  });
});