import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Search } from 'lucide-react';
import Layout from '../components/Layout';
import MemberAvatar from '../components/MemberAvatar';
import PerformanceStudio from '../components/member-profile/PerformanceStudio';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { membersAPI } from '../services/api';

export default function MemberPerformancePage() {
  const { memberId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { isAdmin, user, selectedBranchId } = useAuth();
  const ar = language === 'ar';
  const guest = !memberId && searchParams.get('mode') === 'guest';
  const canEdit = isAdmin || (user?.permissions || []).includes('members-edit') || (user?.permissions || []).includes('coach-notes');
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    if (!memberId) { setMember(null); setError(''); return undefined; }
    let active = true;
    setMember(null);
    setLoading(true);
    setError('');
    membersAPI.getById(memberId).then(response => {
      if (active) setMember(response.data);
    }).catch(() => {
      if (active) setError(ar ? 'تعذر فتح ملف العضو أو ليست لديك صلاحية الوصول إليه.' : 'Could not open this member or access is denied.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [memberId, selectedBranchId, ar]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) { setMatches([]); return undefined; }
    let active = true;
    const timer = window.setTimeout(() => {
      membersAPI.getAll({ search: term, picker_only: true }).then(response => {
        if (active) setMatches((response.data || []).slice(0, 12));
      }).catch(() => { if (active) setMatches([]); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, selectedBranchId]);

  const name = member?.name_ar || member?.name || '';
  return <Layout title={ar ? 'تحليل الأداء' : 'Performance Analysis'}>
    <div className="mx-auto w-full max-w-[1600px] space-y-5" dir={ar ? 'rtl' : 'ltr'}>
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{ar ? 'تحليل الأداء' : 'Performance Analysis'}</h1>
            <p className="mt-1 text-sm text-slate-600">{ar ? 'تحليل الفيديو ومراجعة المفاصل ومقارنة الأداء قبل وبعد' : 'Video analysis, joint review, and before/after comparison'}</p>
          </div>
          {memberId && <Button type="button" variant="outline" onClick={() => navigate(`/admin/members?focus=${encodeURIComponent(memberId)}`)}>
            <ArrowRight className="me-2 h-4 w-4" />{ar ? 'العودة إلى ملف العضو' : 'Back to member profile'}
          </Button>}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" variant={!guest ? 'default' : 'outline'} onClick={() => navigate('/admin/performance')}>{ar ? 'تحليل عضو' : 'Member analysis'}</Button>
          <Button type="button" variant={guest ? 'default' : 'outline'} onClick={() => navigate('/admin/performance?mode=guest')}>{ar ? 'تحليل زائر / غير عضو' : 'Guest analysis'}</Button>
        </div>
        {!guest && <div className="relative mt-5 max-w-xl">
          <Search className="absolute end-3 top-3 h-4 w-4 text-slate-400" />
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder={ar ? 'ابحث عن عضو بالاسم أو الجوال أو رقم العضوية' : 'Search member by name, phone, or code'} className="pe-9" aria-label={ar ? 'بحث عن عضو للتحليل' : 'Search member for analysis'} />
          {matches.length > 0 && <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border bg-white p-1 shadow-lg">
            {matches.map(row => <button type="button" key={row.id} className="flex w-full items-center justify-between rounded px-3 py-2 text-start text-sm hover:bg-slate-100" onClick={() => { setSearch(''); setMatches([]); navigate(`/admin/performance/${encodeURIComponent(row.id)}`); }}>
              <span>{row.name_ar || row.name}</span><span className="text-xs text-slate-500">{row.member_code}</span>
            </button>)}
          </div>}
        </div>}
      </div>
      {guest && <div className="rounded-xl border bg-white p-3 shadow-sm sm:p-6"><PerformanceStudio member={{ id: 'guest', name_ar: 'زائر' }} language={language} canEdit guestMode /></div>}
      {loading && <div className="rounded-xl border bg-white p-8 text-center text-slate-600">{ar ? 'جارٍ فتح ملف العضو…' : 'Loading member…'}</div>}
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">{error}</div>}
      {!memberId && !guest && <div className="rounded-xl border bg-white p-8 text-center text-slate-600">{ar ? 'ابحث عن عضو لفتح استوديو تحليل الأداء، أو اختر تحليل زائر.' : 'Search for a member or choose guest analysis.'}</div>}
      {member && <div className="space-y-4 rounded-xl border bg-white p-3 shadow-sm sm:p-6">
        <div className="flex items-center gap-3 border-b pb-4">
          <MemberAvatar photo={member.photo} name={name} size="md" className="h-11 w-11" />
          <div><h2 className="font-semibold">{name}</h2><p className="text-xs text-slate-500">{member.member_code}</p></div>
        </div>
        <PerformanceStudio key={`${member.id}-${selectedBranchId}`} member={member} language={language} canEdit={canEdit} />
      </div>}
    </div>
  </Layout>;
}
