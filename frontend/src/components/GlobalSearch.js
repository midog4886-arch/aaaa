import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { globalSearchAPI } from '../services/api';
import { Search, Users, Receipt, Dumbbell, X, Loader2, Clock, Trash2 } from 'lucide-react';

const MAX_HISTORY = 10;
const historyKey = (userId, branchId) => `global-search:v2:${userId}:${branchId || 'all'}`;
const readHistory = key => {
  if (!key) return { queries: [], items: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    return {
      queries: Array.isArray(saved.queries) ? saved.queries.filter(q => typeof q === 'string').slice(0, MAX_HISTORY) : [],
      items: Array.isArray(saved.items) ? saved.items.filter(item => item && typeof item.path === 'string' && typeof item.label === 'string' && ['member', 'invoice', 'activity'].includes(item.type)).slice(0, MAX_HISTORY) : [],
    };
  } catch { return { queries: [], items: [] }; }
};

const GlobalSearch = () => {
  const { language } = useLanguage();
  const { selectedBranchId, user, isAdmin } = useAuth();
  const storageKey = user?.id ? historyKey(user.id, selectedBranchId) : null;
  const scope = storageKey || 'anonymous';
  const canSearch = permission => isAdmin || user?.permissions?.includes(permission);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [queryHistory, setQueryHistory] = useState([]);
  const [searchError, setSearchError] = useState(false);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);
  const requestRef = useRef(0);

  useEffect(() => {
    requestRef.current += 1;
    clearTimeout(debounceRef.current);
    const saved = readHistory(storageKey);
    setQuery(''); setResults(null); setLoading(false); setSearchError(false); setIsOpen(false);
    setHistory(saved.items); setQueryHistory(saved.queries);
    return () => { requestRef.current += 1; clearTimeout(debounceRef.current); };
  }, [scope, storageKey]);

  const saveHistory = useCallback((queries, items) => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ queries, items })); } catch { /* storage may be unavailable */ }
  }, [storageKey]);

  const addQueryToHistory = useCallback((value) => {
    const term = value.trim().replace(/\s+/g, ' ');
    if (term.length < 2) return;
    const saved = readHistory(storageKey);
    const updated = [term, ...saved.queries.filter(q => q.toLocaleLowerCase() !== term.toLocaleLowerCase())].slice(0, MAX_HISTORY);
    saveHistory(updated, saved.items);
    setQueryHistory(updated);
  }, [saveHistory, storageKey]);

  const addToHistory = useCallback((item) => {
    const saved = readHistory(storageKey);
    const updated = [item, ...saved.items.filter(h => h.path !== item.path)].slice(0, MAX_HISTORY);
    saveHistory(saved.queries, updated);
    setHistory(updated);
  }, [saveHistory, storageKey]);

  const removeFromHistory = useCallback((path, e) => {
    e.stopPropagation();
    const saved = readHistory(storageKey);
    const updated = saved.items.filter(h => h.path !== path);
    saveHistory(saved.queries, updated);
    setHistory(updated);
  }, [saveHistory, storageKey]);

  const removeQueryFromHistory = useCallback((term) => {
    const saved = readHistory(storageKey);
    const updated = saved.queries.filter(q => q !== term);
    saveHistory(updated, saved.items);
    setQueryHistory(updated);
  }, [saveHistory, storageKey]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setQueryHistory([]);
    if (storageKey) try { localStorage.removeItem(storageKey); } catch { /* storage may be unavailable */ }
  }, [storageKey]);

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
    const request = ++requestRef.current;
    setQuery(value);
    setResults(null);
    setSearchError(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await globalSearchAPI.search(value, selectedBranchId);
        if (request !== requestRef.current) return;
        setResults({
          members: canSearch('members') ? res.data.members : [],
          invoices: canSearch('invoices') ? res.data.invoices : [],
          activities: canSearch('activities') ? res.data.activities : [],
        });
        setIsOpen(true);
      } catch (err) {
        if (request === requestRef.current) { setSearchError(true); setIsOpen(true); }
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    }, 300);
  };

  const handleNavigate = (path, label, type) => {
    requestRef.current += 1;
    clearTimeout(debounceRef.current);
    setLoading(false);
    addToHistory({ path, label, type, timestamp: Date.now() });
    addQueryToHistory(query);
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
          aria-label={language === 'ar' ? 'بحث شامل' : 'Global search'}
          maxLength={200}
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addQueryToHistory(query); }}
          onFocus={() => { setIsOpen(true); }}
          placeholder={language === 'ar' ? 'بحث في الأعضاء، الفواتير، الأنشطة... (Ctrl+K)' : 'Search members, invoices, activities... (Ctrl+K)'}
          className="w-full h-9 ps-9 pe-9 rounded-lg border bg-muted/50 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all placeholder:text-muted-foreground/60"
        />
        {loading && <Loader2 className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />}
        {!loading && query && (
          <button aria-label={language === 'ar' ? 'مسح البحث' : 'Clear search'} onClick={() => { requestRef.current += 1; clearTimeout(debounceRef.current); setQuery(''); setResults(null); setLoading(false); setSearchError(false); setIsOpen(false); }} className="absolute end-3 top-1/2 -translate-y-1/2">
            <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>

      {isOpen && searchError && <div role="alert" className="absolute top-full mt-2 w-full rounded-lg border bg-card p-4 text-sm z-50"><p>{language === 'ar' ? 'تعذر البحث. حاول مجددًا.' : 'Search failed. Please try again.'}</p><button type="button" onClick={() => handleSearch(query)} className="mt-2 text-primary">{language === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button></div>}

      {isOpen && !results && !query && (history.length > 0 || queryHistory.length > 0) && (
        <div className="fixed top-[60px] inset-x-2 sm:absolute sm:top-full sm:inset-x-auto sm:start-0 sm:end-0 sm:mt-2 sm:w-full bg-white rounded-xl shadow-2xl border z-50 overflow-hidden max-h-[70vh] overflow-y-auto">
          <div className="px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-600 flex items-center gap-2 sticky top-0">
            <Clock className="w-3.5 h-3.5" />
            <span className="flex-1">{language === 'ar' ? 'عمليات البحث الأخيرة' : 'Recent searches'}</span>
            <button onClick={clearHistory} className="text-red-400 hover:text-red-600 flex items-center gap-1 text-xs">
              <Trash2 className="w-3 h-3" />
              {language === 'ar' ? 'مسح الكل' : 'Clear all'}
            </button>
          </div>
          {queryHistory.map(term => (
            <div key={term} className="flex items-center border-b hover:bg-gray-50">
              <button type="button" onClick={() => handleSearch(term)} className="flex-1 min-w-0 text-start px-4 py-2.5 text-sm flex items-center gap-3">
                <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" /><span className="truncate">{term}</span>
              </button>
              <button type="button" aria-label={language === 'ar' ? 'حذف البحث من السجل' : 'Remove search from history'} onClick={() => removeQueryFromHistory(term)} className="p-2 me-2 text-muted-foreground hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          {history.filter(h => canSearch(h.type === 'member' ? 'members' : h.type === 'invoice' ? 'invoices' : 'activities')).map((h) => {
            const iconMap = {
              member: { icon: Users, bg: 'bg-blue-100', color: 'text-blue-700', hoverBg: 'hover:bg-blue-50/50', label: language === 'ar' ? 'عضو' : 'Member' },
              invoice: { icon: Receipt, bg: 'bg-green-100', color: 'text-green-700', hoverBg: 'hover:bg-green-50/50', label: language === 'ar' ? 'فاتورة' : 'Invoice' },
              activity: { icon: Dumbbell, bg: 'bg-purple-100', color: 'text-purple-700', hoverBg: 'hover:bg-purple-50/50', label: language === 'ar' ? 'نشاط' : 'Activity' },
            };
            const cfg = iconMap[h.type] || iconMap.member;
            const Icon = cfg.icon;
            return (
              <div key={h.path} className={`flex items-center border-b last:border-b-0 group ${cfg.hoverBg}`}>
              <button type="button" onClick={() => handleNavigate(h.path, h.label, h.type)} className="flex-1 min-w-0 text-start px-4 py-2.5 flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full ${cfg.bg} flex items-center justify-center ${cfg.color} flex-shrink-0`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{h.label}</p>
                  <p className="text-xs text-muted-foreground">{cfg.label}</p>
                </div>
              </button>
                <button type="button" aria-label={language === 'ar' ? 'حذف من السجل' : 'Remove from history'} onClick={(e) => removeFromHistory(h.path, e)}
                  className="p-2 me-2 text-muted-foreground hover:text-red-600 rounded"
                >
                  <X className="w-3.5 h-3.5 text-red-400" />
                </button>
              </div>
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
                      <span className="flex flex-col items-end gap-1 flex-shrink-0">
                        {m.subscription_status && m.subscription_status !== 'no_activity' && (
                          <span data-testid={`member-status-${m.id}`} className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                            m.subscription_status === 'active' ? 'bg-green-100 text-green-700 border-green-300' :
                            m.subscription_status === 'expired' ? 'bg-red-100 text-red-700 border-red-300' :
                            'bg-gray-100 text-gray-600 border-gray-300'
                          }`}>
                            {m.subscription_status === 'active' ? (language === 'ar' ? 'نشط' : 'Active') :
                             m.subscription_status === 'expired' ? (language === 'ar' ? 'منتهي' : 'Expired') :
                             (language === 'ar' ? 'غير نشط' : 'Inactive')}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                          {m.activities_count} {language === 'ar' ? 'نشاط' : 'activities'}
                        </span>
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
