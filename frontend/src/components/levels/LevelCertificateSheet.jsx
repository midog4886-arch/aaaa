import React, { forwardRef } from 'react';
import './LevelCertificateSheet.css';

const LevelCertificateSheet = forwardRef(function LevelCertificateSheet({ certificate }, ref) {
  if (!certificate) return null;
  const artwork = certificate.artwork || {};
  const position = (value, fallback) => Number.isFinite(Number(value)) ? `${Number(value)}%` : `${fallback}%`;
  const style = {
    '--certificate-name-top': position(artwork.name_top, 55.2),
    '--certificate-name-left': position(artwork.name_left, 23),
    '--certificate-name-width': position(artwork.name_width, 54),
    '--certificate-date-top': position(artwork.date_top, 79.5),
    '--certificate-date-left': position(artwork.date_left, 24),
    '--certificate-date-width': position(artwork.date_width, 15.5),
    '--certificate-stamp-left': position(artwork.stamp_left, 65),
    '--certificate-stamp-top': position(artwork.stamp_top, 77),
    '--certificate-stamp-width': position(artwork.stamp_width, 16),
  };
  const issuedAt = certificate.issued_at || certificate.created_at;
  const issuedDate = issuedAt && !Number.isNaN(new Date(issuedAt).getTime())
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(issuedAt))
    : '';
  return <div ref={ref} className="level-certificate-sheet" style={style} aria-label="الشهادة">
    <img className="level-certificate-bg" src={artwork.design_url || '/images/level-achievement-certificate.jpeg'} alt="تصميم الشهادة" />
    <div className="level-certificate-recipient">
      <strong dir="rtl">{certificate.member_name || 'اسم اللاعب بالعربية'}</strong>
      <span dir="ltr">{certificate.member_name_en || 'Player name in English'}</span>
    </div>
    {issuedDate && <time className="level-certificate-date" dateTime={issuedAt} dir="ltr">{issuedDate}</time>}
    {artwork.stamp_url && <img className="level-certificate-stamp" src={artwork.stamp_url} alt="ختم الفرع" />}
  </div>;
});

export default LevelCertificateSheet;
