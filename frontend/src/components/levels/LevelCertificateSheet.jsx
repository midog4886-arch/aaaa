import React, { forwardRef } from 'react';
import './LevelCertificateSheet.css';

// Preserve the academy-supplied artwork exactly. Only the two name lines are
// overlaid in its existing recipient area; all metadata stays outside it.
const LevelCertificateSheet = forwardRef(function LevelCertificateSheet({ certificate }, ref) {
  if (!certificate) return null;
  return <div ref={ref} className="level-certificate-sheet" aria-label="شهادة اجتياز مستوى">
    <img className="level-certificate-bg" src="/images/level-achievement-certificate.jpeg" alt="الشهادة الأصلية لأكاديمية أداء الأبطال" />
    <div className="level-certificate-recipient">
      <strong dir="rtl">{certificate.member_name || 'اسم اللاعب بالعربية'}</strong>
      <span dir="ltr">{certificate.member_name_en || 'Player name in English'}</span>
    </div>
  </div>;
});

export default LevelCertificateSheet;
