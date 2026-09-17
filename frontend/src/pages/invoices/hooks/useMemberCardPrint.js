import { useState } from 'react';
import { toast } from 'sonner';
import { membersAPI } from '../../../services/api';
import { openStickerPrint } from '../StickerPrintDialog';

export const useMemberCardPrint = ({ members, branches = [], language }) => {
  const [showCardPrintDialog, setShowCardPrintDialog] = useState(false);
  const [cardPrintMember, setCardPrintMember] = useState(null);
  const [showRegFormCardPrintDialog, setShowRegFormCardPrintDialog] = useState(false);
  const [regFormCardData, setRegFormCardData] = useState(null);

  const noLinkedMemberMessage = language === 'ar'
    ? 'لا يمكن طباعة البطاقة: لا يوجد عضو مرتبط بهذه العملية.'
    : 'Cannot print card: this record is not linked to a member.';
  const noIssuedCodeMessage = language === 'ar'
    ? 'لا يمكن طباعة البطاقة: لم يصدر رقم عضوية لهذا العضو.'
    : 'Cannot print card: this member has no issued membership code.';

  const resolveLinkedMember = async (memberId) => {
    if (!memberId) {
      toast.error(noLinkedMemberMessage);
      return null;
    }
    const loadedMember = (members || []).find((member) => String(member.id) === String(memberId));
    if (loadedMember) return loadedMember;
    try {
      const response = await membersAPI.getById(memberId);
      return response?.data || null;
    } catch (_error) {
      toast.error(noLinkedMemberMessage);
      return null;
    }
  };

  const printSubscriptionCard = (cardMember) => {
    if (!cardMember?.member_code) {
      toast.error(language === 'ar' ? 'رقم العضوية غير متوفر للطباعة' : 'Membership number is unavailable for printing');
      return false;
    }

    const branch = branches.find((item) => String(item.id) === String(cardMember.branch_id));
    // Contact information remains scoped strictly to the linked member's
    // branch; invoice/customer phone values are never used as branch contact.
    const popup = openStickerPrint({
      ...cardMember,
      branch_name: cardMember.branch_name || branch?.name_ar || branch?.name || '',
      branch_phone: cardMember.branch_phone || branch?.phone || '',
      show_terms_on_logo: true,
      strict_branch_contact: true,
    });
    if (!popup) {
      toast.error(language === 'ar' ? 'تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.' : 'Print window was blocked. Allow pop-ups and try again.');
      return false;
    }
    return true;
  };

  const handleOpenCardPrint = async (invoice) => {
    const member = await resolveLinkedMember(invoice?.member_id);
    if (!member) return;
    if (!member.member_code) {
      toast.error(noIssuedCodeMessage);
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    const allWindows = (invoice?.items || [])
      .filter((item) => !item.is_product)
      .map((item) => {
        let startDate = item.start_date || '';
        let endDate = item.end_date || '';
        if ((!startDate || !endDate) && item.period) {
          const [periodStart, periodEnd] = item.period.split(' - ');
          startDate = startDate || periodStart?.trim() || '';
          endDate = endDate || periodEnd?.trim() || '';
        }
        return {
          activity_id: item.activity_id || '',
          activity_name: item.activity_name || '',
          start_date: startDate,
          end_date: endDate,
          schedule: item.schedule || '',
          status: !endDate || endDate >= today ? 'active' : 'expired',
          level_name: item.level_name || '',
        };
      });
    // Keep one relevant purchased window per activity: current first, then the
    // earliest upcoming period, then the most recently ended period.
    const byActivity = {};
    allWindows.forEach((window) => {
      const key = window.activity_id || window.activity_name || '';
      const rank = (candidate) => {
        if (!candidate.end_date) return [2, ''];
        const coversToday = (!candidate.start_date || candidate.start_date <= today)
          && candidate.end_date >= today;
        if (coversToday) return [0, candidate.start_date || ''];
        if (candidate.start_date && candidate.start_date > today) return [1, candidate.start_date];
        return [2, candidate.end_date];
      };
      const previous = byActivity[key];
      if (!previous) {
        byActivity[key] = window;
        return;
      }
      const [candidateRank, candidateDate] = rank(window);
      const [previousRank, previousDate] = rank(previous);
      if (
        candidateRank < previousRank
        || (candidateRank === previousRank
          && ((candidateRank === 1 && candidateDate < previousDate)
            || (candidateRank !== 1 && candidateDate > previousDate)))
      ) {
        byActivity[key] = window;
      }
    });
    const activities = Object.values(byActivity);
    setCardPrintMember({ ...member, activities });
    setShowCardPrintDialog(true);
  };

  const handleStickerPrint = () => {
    if (printSubscriptionCard(cardPrintMember)) setShowCardPrintDialog(false);
  };

  const handleRegFormStickerPrint = () => {
    if (printSubscriptionCard(regFormCardData)) setShowRegFormCardPrintDialog(false);
  };

  const handlePrintRegFormCard = async (form) => {
    const member = await resolveLinkedMember(form?.member_id);
    if (!member) return;
    if (!member.member_code) {
      toast.error(noIssuedCodeMessage);
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    const activities = (form?.items || [])
      .filter((item) => !item.is_product)
      .map((item) => ({
        activity_id: item.activity_id || '',
        activity_name: item.activity_name || '',
        start_date: item.start_date || '',
        end_date: item.end_date || '',
        schedule: item.schedule || '',
        status: !item.end_date || item.end_date >= today ? 'active' : 'expired',
        level_name: item.level_name || '',
      }));
    setRegFormCardData({ ...member, activities });
    setShowRegFormCardPrintDialog(true);
  };

  return {
    showCardPrintDialog, setShowCardPrintDialog,
    cardPrintMember, setCardPrintMember,
    showRegFormCardPrintDialog, setShowRegFormCardPrintDialog,
    regFormCardData, setRegFormCardData,
    handleOpenCardPrint, handleStickerPrint, handleRegFormStickerPrint, handlePrintRegFormCard,
  };
};