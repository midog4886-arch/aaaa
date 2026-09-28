import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

export default function LevelCertificateSeal({ certificate }) {
  if (!certificate?.id || !certificate.seal_valid) return null;
  const verifyUrl = `${window.location.origin}/certificate/verify/${encodeURIComponent(certificate.id)}`;
  return <div className="level-certificate-seal" dir="rtl">
    <div className="level-certificate-seal-mark">
      <strong>ختم أكاديمية أداء الأبطال الإلكتروني</strong>
      <span>شهادة معتمدة وقابلة للتحقق</span>
    </div>
    <div className="level-certificate-seal-issuer">
      <strong>توقيع الاعتماد الإلكتروني</strong>
      <span>{certificate.issued_by_name || 'موظف الأكاديمية'}</span>
      <small>{certificate.issued_at ? new Date(certificate.issued_at).toLocaleDateString('ar-SA') : ''}</small>
    </div>
    <div className="level-certificate-seal-code">
      <QRCodeSVG value={verifyUrl} size={58} />
      <small dir="ltr">{certificate.id}</small>
    </div>
  </div>;
}
