import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { globalSearchAPI } from '../services/api';
import { Search, Users, Receipt, Dumbbell, X, Loader2, Clock, Trash2 } from 'lucide-react';

const HISTORY_KEY = 'global_search_history';
const MAX_HISTORY = 10;

const getSearchHistory = () => {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch { return []; }
};

const saveSearchHistory = (history) => {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
};

const GlobalSearch = () => {
  const { language } = useLanguage();
  const { selectedBranchId } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [history, setHistory] = useState(getSearchHistory);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);

  const addToHistory = useCallback((item) => {
    setHistory(prev => {
      const filtered = prev.filter(h => h.path !== item.path);
      const updated = [item, ...filtered].slice(0, MAX_HISTORY);
      saveSearchHistory(updated);
      return updated;
    });
  }, []);

  const removeFromHistory = useCallback((path, e) => {
    e.stopPropagation();
    setHistory(prev => {
      const updated = prev.filter(h => h.path !== path);
      saveSearchHistory(updated);
      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveSearchHistory([]);
  }, []);

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
        const res = await globalSearchAPI.search(value, selectedBranchId);
        setResults(res.data);
        setIsOpen(true);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const handleNavigate = (path, label, type) => {
    addToHistory({ path, label, type, timestamp: Date.now() });
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
          onFocus={() => { setIsOpen(true); }}
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

      {isOpen && !results && !query && history.length > 0 && (
        <div className="fixed top-[60px] inset-x-2 sm:absolute sm:top-full sm:inset-x-auto sm:start-0 sm:end-0 sm:mt-2 sm:w-full bg-white rounded-xl shadow-2xl border z-50 overflow-hidden max-h-[70vh] overflow-y-auto">
          <div className="px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-600 flex items-center gap-2 sticky top-0">
            <Clock className="w-3.5 h-3.5" />
            <span className="flex-1">{language === 'ar' ? 'عمليات البحث الأخيرة' : 'Recent searches'}</span>
            <button onClick={clearHistory} className="text-red-400 hover:text-red-600 flex items-center gap-1 text-xs">
              <Trash2 className="w-3 h-3" />
              {language === 'ar' ? 'مسح الكل' : 'Clear all'}
            </button>
          </div>
          {history.map((h) => {
            const iconMap = {
              member: { icon: Users, bg: 'bg-blue-100', color: 'text-blue-700', hoverBg: 'hover:bg-blue-50/50', label: language === 'ar' ? 'عضو' : 'Member' },
              invoice: { icon: Receipt, bg: 'bg-green-100', color: 'text-green-700', hoverBg: 'hover:bg-green-50/50', label: language === 'ar' ? 'فاتورة' : 'Invoice' },
              activity: { icon: Dumbbell, bg: 'bg-purple-100', color: 'text-purple-700', hoverBg: 'hover:bg-purple-50/50', label: language === 'ar' ? 'نشاط' : 'Activity' },
            };
            const cfg = iconMap[h.type] || iconMap.member;
            const Icon = cfg.icon;
            return (
              <button
                key={h.path}
                onClick={() => { navigate(h.path); setIsOpen(false); }}
                className={`w-full text-start px-4 py-2.5 ${cfg.hoverBg} transition-colors flex items-center gap-3 border-b last:border-b-0 group`}
              >
                <div className={`w-8 h-8 rounded-full ${cfg.bg} flex items-center justify-center ${cfg.color} flex-shrink-0`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{h.label}</p>
                  <p className="text-xs text-muted-foreground">{cfg.label}</p>
                </div>
                <button
                  onClick={(e) => removeFromHistory(h.path, e)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-100 rounded"
                >
                  <X className="w-3.5 h-3.5 text-red-400" />
                </button>
              </button>
            );
          })}
        </div>
      )}

      {isOpen && results && (
        <div className="fixed top-[60px] inset-x-2 sm:absolute sm:top-full sm:inset-x-auto sm:start-0 sm:end-0 sm:mt-2 sm:w-full bg-white rounded-xl shadow-2xl border z-50 overflow-hidden max-h-[70vh] overflow-y-auto">
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
                      onClick={() => handleNavigate(`/admin/members?focus=${encodeURIComponent(m.id)}`, m.name, 'member')}
                      className="w-full text-start px-4 py-2.5 hover:bg-blue-50/50 transition-colors flex items-center gap-3 border-b last:border-b-0"
                    >
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-sm font-bold flex-shrink-0">
                        {m.name?.charAt(0) || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {m.name}
                          {m.guardian_name && (
                            <span className="text-xs text-muted-foreground font-normal">
                              {' — '}
                              {language === 'ar' ? 'ولي الأمر: ' : 'Guardian: '}
                              {m.guardian_name}
                            </span>
                          )}
                        </p>
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
                      onClick={() => handleNavigate(`/admin/invoices?view=${encodeURIComponent(inv.id)}`, `#${inv.invoice_number} - ${inv.member_name}`, 'invoice')}
                      className="w-full text-start px-4 py-2.5 hover:bg-green-50/50 transition-colors flex items-center gap-3 border-b last:border-b-0"
                    >
                      <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 flex-shrink-0">
                        <Receipt className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">#{inv.invoice_number} - {inv.member_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {inv.total?.toLocaleString()} {language === 'ar' ? 'ر.س' : 'SAR'}
                          {inv.created_at && (
                            <span className="text-gray-400"> • {new Date(inv.created_at).toLocaleDateString('en-GB')}</span>
                          )}
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
                      onClick={() => handleNavigate(`/admin/activities?view=${encodeURIComponent(a.id)}`, a.name, 'activity')}
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
