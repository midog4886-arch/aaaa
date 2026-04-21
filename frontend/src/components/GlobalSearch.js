import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { globalSearchAPI } from '../services/api';
import { Search, Users, Receipt, Dumbbell, X, Loader2 } from 'lucide-react';

const GlobalSearch = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSearch = (value) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await globalSearchAPI.search(value);
        setResults(res.data);
        setIsOpen(true);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const handleNavigate = (path) => {
    setIsOpen(false);
    setQuery('');
    setResults(null);
    navigate(path);
  };

  const totalResults = results
    ? (results.members?.length || 0) + (results.invoices?.length || 0) + (results.activities?.length || 0)
    : 0;

  return (
    <div ref={containerRef} className="relative flex-1 max-w-md">
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={() => { if (results) setIsOpen(true); }}
          placeholder={language === 'ar' ? 'بحث في الأعضاء، الفواتير، الأنشطة... (Ctrl+K)' : 'Search members, invoices, activities... (Ctrl+K)'}
          className="w-full h-9 ps-9 pe-9 rounded-lg border bg-muted/50 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all placeholder:text-muted-foreground/60"
        />
        {loading && <Loader2 className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />}
        {!loading && query && (
          <button onClick={() => { setQuery(''); setResults(null); setIsOpen(false); }} className="absolute end-3 top-1/2 -translate-y-1/2">
            <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>

      {isOpen && results && (
        <div className="absolute top-full mt-2 w-full bg-white rounded-xl shadow-2xl border z-50 overflow-hidden max-h-[70vh] overflow-y-auto">
          {totalResults === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">{language === 'ar' ? 'لا توجد نتائج' : 'No results found'}</p>
            </div>
          ) : (
            <>
              {results.members?.length > 0 && (
                <div>
                  <div className="px-3 py-2 bg-blue-50 text-xs font-semibold text-blue-700 flex items-center gap-2 sticky top-0">
                    <Users className="w-3.5 h-3.5" />
                    {language === 'ar' ? `الأعضاء (${results.members.length})` : `Members (${results.members.length})`}
                  </div>
                  {results.members.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => handleNavigate(`/admin/members?focus=${encodeURIComponent(m.id)}`)}
                      className="w-full text-start px-4 py-2.5 hover:bg-blue-50/50 transition-colors flex items-center gap-3 border-b last:border-b-0"
                    >
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-sm font-bold flex-shrink-0">
                        {m.name?.charAt(0) || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{m.name}</p>
                        <p className="text-xs text-muted-foreground" dir="ltr">{m.phone}</p>
                      </div>
                      <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                        {m.activities_count} {language === 'ar' ? 'نشاط' : 'activities'}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {results.invoices?.length > 0 && (
                <div>
                  <div className="px-3 py-2 bg-green-50 text-xs font-semibold text-green-700 flex items-center gap-2 sticky top-0">
                    <Receipt className="w-3.5 h-3.5" />
                    {language === 'ar' ? `الفواتير (${results.invoices.length})` : `Invoices (${results.invoices.length})`}
                  </div>
                  {results.invoices.map((inv) => (
                    <button
                      key={inv.id}
                      onClick={() => handleNavigate(`/admin/invoices?search=${encodeURIComponent(inv.invoice_number || inv.member_name)}`)}
                      className="w-full text-start px-4 py-2.5 hover:bg-green-50/50 transition-colors flex items-center gap-3 border-b last:border-b-0"
                    >
                      <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 flex-shrink-0">
                        <Receipt className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">#{inv.invoice_number} - {inv.member_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {inv.total?.toLocaleString()} {language === 'ar' ? 'ر.س' : 'SAR'}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        inv.status === 'paid' ? 'bg-green-100 text-green-700' :
                        inv.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {inv.status === 'paid' ? (language === 'ar' ? 'مدفوعة' : 'Paid') :
                         inv.status === 'cancelled' ? (language === 'ar' ? 'ملغية' : 'Cancelled') :
                         (language === 'ar' ? 'معلقة' : 'Pending')}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {results.activities?.length > 0 && (
                <div>
                  <div className="px-3 py-2 bg-purple-50 text-xs font-semibold text-purple-700 flex items-center gap-2 sticky top-0">
                    <Dumbbell className="w-3.5 h-3.5" />
                    {language === 'ar' ? `الأنشطة (${results.activities.length})` : `Activities (${results.activities.length})`}
                  </div>
                  {results.activities.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => handleNavigate('/admin/activities')}
                      className="w-full text-start px-4 py-2.5 hover:bg-purple-50/50 transition-colors flex items-center gap-3 border-b last:border-b-0"
                    >
                      <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 flex-shrink-0">
                        <Dumbbell className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{a.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.monthly_fee?.toLocaleString()} {language === 'ar' ? 'ر.س/شهر' : 'SAR/month'}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default GlobalSearch;
