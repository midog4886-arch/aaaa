import React, { useState, useEffect } from 'react';

const SIZE_PRESETS = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-12 h-12 text-base',
  lg: 'w-16 h-16 text-xl',
};

export default function MemberAvatar({
  photo,
  name,
  size = 'md',
  className = '',
  borderClass = 'border-blue-300',
  bgClass = 'bg-blue-100',
  textClass = 'text-blue-700',
}) {
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [photo]);

  const sizeClass = SIZE_PRESETS[size] || SIZE_PRESETS.md;

  const initials = (name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase() || '?';

  if (photo && !errored) {
    return (
      <img
        src={photo}
        alt={name || 'member'}
        onError={() => setErrored(true)}
        className={`${sizeClass} rounded-full object-cover border-2 ${borderClass} flex-shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center font-bold border-2 ${borderClass} ${bgClass} ${textClass} flex-shrink-0 ${className}`}
    >
      {initials}
    </div>
  );
}
