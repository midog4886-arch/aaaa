/**
 * Invoice Summary Cards Component
 * كروت ملخص الفواتير
 */
import React from 'react';
import { Card, CardContent } from '../../../components/ui/card';
import { FileText, CheckCircle, Clock, XCircle, Undo } from 'lucide-react';

const InvoiceSummaryCards = ({ invoices, language = 'ar', t }) => {
  // Calculate totals
  const totalInvoices = invoices.length;
  const paidInvoices = invoices.filter(i => i.status === 'paid');
  const pendingInvoices = invoices.filter(i => i.status === 'pending');
  const cancelledInvoices = invoices.filter(i => i.status === 'cancelled');
  const refundedInvoices = invoices.filter(i => i.status === 'refunded' || i.status === 'partially_refunded');

  const totalPaid = paidInvoices.reduce((sum, i) => sum + (i.total || 0), 0);
  const totalPending = pendingInvoices.reduce((sum, i) => sum + (i.total || 0), 0);
  const totalRefunded = refundedInvoices.reduce((sum, i) => sum + (i.refund_amount || 0), 0);

  const cards = [
    {
      title: language === 'ar' ? 'إجمالي الفواتير' : 'Total Invoices',
      value: totalInvoices,
      subValue: `${(totalPaid + totalPending).toFixed(2)} ${t('sar')}`,
      icon: FileText,
      color: 'bg-blue-500',
      lightColor: 'bg-blue-50',
      textColor: 'text-blue-600'
    },
    {
      title: language === 'ar' ? 'المدفوعة' : 'Paid',
      value: paidInvoices.length,
      subValue: `${totalPaid.toFixed(2)} ${t('sar')}`,
      icon: CheckCircle,
      color: 'bg-green-500',
      lightColor: 'bg-green-50',
      textColor: 'text-green-600'
    },
    {
      title: language === 'ar' ? 'المعلقة' : 'Pending',
      value: pendingInvoices.length,
      subValue: `${totalPending.toFixed(2)} ${t('sar')}`,
      icon: Clock,
      color: 'bg-amber-500',
      lightColor: 'bg-amber-50',
      textColor: 'text-amber-600'
    },
    {
      title: language === 'ar' ? 'الملغاة' : 'Cancelled',
      value: cancelledInvoices.length,
      icon: XCircle,
      color: 'bg-red-500',
      lightColor: 'bg-red-50',
      textColor: 'text-red-600'
    },
    {
      title: language === 'ar' ? 'المستردة' : 'Refunded',
      value: refundedInvoices.length,
      subValue: totalRefunded > 0 ? `${totalRefunded.toFixed(2)} ${t('sar')}` : null,
      icon: Undo,
      color: 'bg-purple-500',
      lightColor: 'bg-purple-50',
      textColor: 'text-purple-600'
    }
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {cards.map((card, index) => (
        <Card key={index} className={`${card.lightColor} border-none`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{card.title}</p>
                <p className={`text-2xl font-bold ${card.textColor}`}>{card.value}</p>
                {card.subValue && (
                  <p className="text-sm text-muted-foreground mt-1">{card.subValue}</p>
                )}
              </div>
              <div className={`${card.color} p-3 rounded-full`}>
                <card.icon className="w-5 h-5 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default InvoiceSummaryCards;
