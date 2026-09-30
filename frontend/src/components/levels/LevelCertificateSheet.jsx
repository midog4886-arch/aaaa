import React, { forwardRef } from 'react';
import './LevelCertificateSheet.css';

const LevelCertificateSheet = forwardRef(function LevelCertificateSheet({ certificate }, ref) {
  if (!certificate) return null;
  const issuedAt = certificate.issued_at || certificate.created_at;
  const issuedDate = issuedAt && !Number.isNaN(new Date(issuedAt).getTime())
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(issuedAt))
    : '';
  return <div ref={ref} className="level-certificate-sheet" aria-label="شهادة اجتياز مستوى">
    <img className="level-certificate-bg" src="/images/level-achievement-certificate.jpeg" alt="الشهادة الأصلية لأكاديمية أداء الأبطال" />
    <div className="level-certificate-recipient">
      <strong dir="rtl">{certificate.member_name || 'اسم اللاعب بالعربية'}</strong>
      <span dir="ltr">{certificate.member_name_en || 'Player name in English'}</span>
    </div>
    {issuedDate && <time className="level-certificate-date" dateTime={issuedAt} dir="ltr">{issuedDate}</time>}
  </div>;
});

export default LevelCertificateSheet;
