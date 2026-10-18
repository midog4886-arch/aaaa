import React from 'react';
import { chartPoints, metricLabel } from '../../utils/performanceReport';

const paths = points => {
  const segments = [];
  let segment = [];
  for (const point of points) {
    if (segment.length && point.x - segment[segment.length - 1].x > 0.38) {
      segments.push(segment);
      segment = [];
    }
    segment.push(point);
  }
  if (segment.length) segments.push(segment);
  return segments.map(group => group.map((point, index) =>
    `${index ? 'L' : 'M'}${40 + (point.x + 2) * 110},${170 - point.y * 0.8}`).join(' '));
};

export default function ComparisonChart({ beforeSamples, afterSamples, beforeAnchor, afterAnchor, metric }) {
  const before = paths(chartPoints(beforeSamples, beforeAnchor, metric));
  const after = paths(chartPoints(afterSamples, afterAnchor, metric));
  return <div className="rounded-lg border bg-white p-3">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
      <strong>{metricLabel(metric)} حول لحظة الحركة</strong>
      <span><span className="text-slate-500">● قبل</span>　<span className="text-blue-700">● بعد</span></span>
    </div>
    <svg viewBox="0 0 520 200" role="img" aria-label={`تغير ${metricLabel(metric)} قبل وبعد`} className="w-full">
      <path d="M40 26V170H480" stroke="#cbd5e1" fill="none" />
      <path d="M260 26V170" stroke="#94a3b8" strokeDasharray="4 4" />
      {[0, 90, 180].map(value => <g key={value}><text x="4" y={174 - value * 0.8} fontSize="11" fill="#64748b">{value}°</text></g>)}
      {[-2, 0, 2].map(value => <text key={value} x={40 + (value + 2) * 110} y="190" fontSize="11" fill="#64748b">{value > 0 ? '+' : ''}{value}ث</text>)}
      {before.map((path, index) => <path key={`before-${index}`} d={path} stroke="#64748b" strokeWidth="2" fill="none" />)}
      {after.map((path, index) => <path key={`after-${index}`} d={path} stroke="#2563eb" strokeWidth="2.5" fill="none" />)}
    </svg>
    {(!before.length || !after.length) && <p className="text-xs text-amber-700">لا توجد نقاط واضحة كافية لرسم الفيديوين. الفجوات لا تُملأ بأرقام تخمينية.</p>}
  </div>;
}
