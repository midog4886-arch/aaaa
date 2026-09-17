import { useState } from 'react';
import { toast } from 'sonner';
import { getAcademyLogoUrl, getAcademyName } from '../../../services/branding';
import { membersAPI } from '../../../services/api';
import { getMemberQRValue } from '../../../utils/memberQR';
import { openPermanentMemberCardPrint } from '../../../utils/permanentMemberCard';

const DEFAULT_ACADEMY_NAME = 'شركة اداء الابطال العالمية للرياضة';

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

  const printPermanentCard = (cardMember) => {
    if (!cardMember?.member_code) {
      toast.error(language === 'ar' ? 'رقم العضوية غير متوفر للطباعة' : 'Membership number is unavailable for printing');
      return false;
    }

    const branch = branches.find((item) => String(item.id) === String(cardMember.branch_id));
    const popup = openPermanentMemberCardPrint({
      member: cardMember,
      qrValue: getMemberQRValue(cardMember.member_code),
      logoUrl: getAcademyLogoUrl(),
      academyName: getAcademyName() || DEFAULT_ACADEMY_NAME,
      // Resolve strictly from this member's branch. Never substitute the
      // invoice customer's/member's phone or a different branch's contact.
      branchName: cardMember.branch_name || branch?.name_ar || branch?.name || '',
      branchPhone: cardMember.branch_phone || branch?.phone || '',
      language: language === 'en' ? 'en' : 'ar',
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
    setCardPrintMember(member);
    setShowCardPrintDialog(true);
  };

  const handleStickerPrint = () => {
    if (printPermanentCard(cardPrintMember)) setShowCardPrintDialog(false);
  };

  const handleRegFormStickerPrint = () => {
    if (printPermanentCard(regFormCardData)) setShowRegFormCardPrintDialog(false);
  };

  const handlePrintRegFormCard = async (form) => {
    const member = await resolveLinkedMember(form?.member_id);
    if (!member) return;
    if (!member.member_code) {
      toast.error(noIssuedCodeMessage);
      return;
    }
    setRegFormCardData(member);
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