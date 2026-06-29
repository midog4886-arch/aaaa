import React, { useState, useRef, useEffect } from 'react';
import { NATIONALITY_OPTIONS, nationalityLabel } from '../utils/nationalities';

// Searchable nationality picker. Stores the canonical Arabic value (so existing
// data and reports grouping stay consistent) while displaying the localized
// label. Uses a self-contained dropdown (not native <datalist>) so search works
// reliably inside dialogs and the Android WebView.
export function NationalitySelect({ value, onChange, language, placeholder, 'data-testid': testId }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const display = value ? nationalityLabel(value, language === 'en' ? 'en' : 'ar') : '';
  const q = query.trim().toLowerCase();
  const filtered = NATIONALITY_OPTIONS.filter(
    (o) => !q || o.value.toLowerCase().includes(q) || o.en.toLowerCase().includes(q)
  );
  const align = language === 'ar' ? 'text-right' : 'text-left';

  return (
    <div className="relative" ref={wrapRef}>
      <input
        type="text"
        value={open ? query : display}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        data-testid={testId}
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-input bg-white shadow-lg">
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
                setQuery('');
              }}
              className={`block w-full ${align} px-3 py-2 text-xs text-gray-500 hover:bg-gray-100 border-b`}
            >
              {language === 'ar' ? 'مسح الاختيار' : 'Clear'}
            </button>
          )}
          {filtered.length === 0 ? (
            <div className={`px-3 py-2 text-sm text-gray-400 ${align}`}>
              {language === 'ar' ? 'لا توجد نتائج' : 'No results'}
            </div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                  setQuery('');
                }}
                className={`block w-full ${align} px-3 py-2 text-sm hover:bg-gray-100 ${
                  o.value === value ? 'bg-blue-50 font-medium' : ''
                }`}
              >
                {language === 'ar' ? o.value : o.en}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
