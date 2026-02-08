import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { FileText, Download, Eye, Loader2, Receipt } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import MemberLayout, { memberAPI } from './MemberLayout';
import jsPDF from 'jspdf';

const MemberInvoices = () => {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);

  useEffect(() => {
    fetchInvoices();
  }, []);

  const fetchInvoices = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/invoices');
      setInvoices(res.data.invoices);
    } catch (error) {
      console.error('Failed to fetch invoices');
    } finally {
      setLoading(false);
    }
  };

  const handleViewInvoice = (invoice) => {
    setSelectedInvoice(invoice);
    setViewDialogOpen(true);
  };

  const handleDownloadPDF = (invoice) => {
    const doc = new jsPDF();
    
    // Add Arabic font support header
    doc.setFont('helvetica');
    
    // Header
    doc.setFontSize(20);
    doc.text('World Champions Performance Academy', 105, 20, { align: 'center' });
    
    doc.setFontSize(12);
    doc.text('Invoice / Fatura', 105, 30, { align: 'center' });
    
    // Invoice Info
    doc.setFontSize(10);
    doc.text(`Invoice #: ${invoice.invoice_number}`, 20, 50);
    doc.text(`Date: ${new Date(invoice.created_at).toLocaleDateString('en-GB')}`, 20, 58);
    doc.text(`Status: ${invoice.status}`, 20, 66);
    
    // Customer Info
    doc.text(`Customer: ${invoice.member_name || invoice.customer_name_ar}`, 120, 50);
    doc.text(`Phone: ${invoice.customer_phone || ''}`, 120, 58);
    
    // Items Table Header
    doc.setFillColor(41, 65, 148);
    doc.rect(20, 80, 170, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text('Item', 25, 87);
    doc.text('Period', 80, 87);
    doc.text('Amount', 160, 87);
    
    // Items
    doc.setTextColor(0, 0, 0);
    let y = 100;
    invoice.items?.forEach((item, idx) => {
      doc.text(item.activity_name || item.description || 'Item', 25, y);
      doc.text(item.period || '-', 80, y);
      doc.text(`${item.fee || item.price || 0} SAR`, 160, y);
      y += 10;
    });
    
    // Totals
    y += 10;
    doc.line(20, y, 190, y);
    y += 10;
    doc.text(`Subtotal: ${invoice.subtotal || 0} SAR`, 140, y);
    y += 8;
    if (invoice.discount > 0) {
      doc.text(`Discount: -${invoice.discount} SAR`, 140, y);
      y += 8;
    }
    doc.text(`VAT (15%): ${invoice.vat_amount || 0} SAR`, 140, y);
    y += 8;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total: ${invoice.total || 0} SAR`, 140, y);
    
    // Footer
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('Thank you for your business!', 105, 280, { align: 'center' });
    
    // Save
    doc.save(`invoice-${invoice.invoice_number}.pdf`);
  };

  const getStatusBadge = (status) => {
    const styles = {
      paid: 'bg-green-100 text-green-700',
      partial: 'bg-orange-100 text-orange-700',
      pending: 'bg-yellow-100 text-yellow-700',
      cancelled: 'bg-red-100 text-red-700'
    };
    const labels = {
      paid: 'مدفوعة',
      partial: 'مدفوعة جزئياً',
      pending: 'معلقة',
      cancelled: 'ملغية'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-700'}`}>
        {labels[status] || status}
      </span>
    );
  };

  if (loading) {
    return (
      <MemberLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </MemberLayout>
    );
  }

  return (
    <MemberLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">فواتيري</h1>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Receipt className="w-5 h-5 text-purple-600" />
              جميع الفواتير ({invoices.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {invoices.length > 0 ? (
              <div className="space-y-4">
                {invoices.map((invoice, idx) => (
                  <div key={idx} className="p-4 bg-gray-50 rounded-lg border hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <FileText className="w-5 h-5 text-purple-600" />
                          <span className="font-bold">فاتورة #{invoice.invoice_number}</span>
                          {getStatusBadge(invoice.status)}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          {new Date(invoice.created_at).toLocaleDateString('ar-SA')}
                        </p>
                        <div className="mt-2">
                          {invoice.items?.slice(0, 2).map((item, i) => (
                            <span key={i} className="text-sm text-gray-600 block">
                              • {item.activity_name || item.description}
                            </span>
                          ))}
                          {invoice.items?.length > 2 && (
                            <span className="text-sm text-gray-400">+{invoice.items.length - 2} المزيد</span>
                          )}
                        </div>
                      </div>
                      
                      <div className="text-left">
                        <p className="text-2xl font-bold text-gray-800">{invoice.total} <span className="text-sm">ر.س</span></p>
                        <div className="flex gap-2 mt-2">
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => handleViewInvoice(invoice)}
                            className="gap-1"
                          >
                            <Eye className="w-4 h-4" />
                            عرض
                          </Button>
                          <Button 
                            size="sm" 
                            onClick={() => handleDownloadPDF(invoice)}
                            className="gap-1 bg-purple-600 hover:bg-purple-700"
                          >
                            <Download className="w-4 h-4" />
                            PDF
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>لا توجد فواتير</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Invoice View Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>فاتورة #{selectedInvoice?.invoice_number}</DialogTitle>
          </DialogHeader>
          
          {selectedInvoice && (
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">التاريخ:</span>
                <span>{new Date(selectedInvoice.created_at).toLocaleDateString('ar-SA')}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">الحالة:</span>
                {getStatusBadge(selectedInvoice.status)}
              </div>
              
              <div className="border-t pt-4">
                <p className="font-medium mb-2">البنود:</p>
                {selectedInvoice.items?.map((item, idx) => (
                  <div key={idx} className="flex justify-between py-2 border-b">
                    <span>{item.activity_name || item.description}</span>
                    <span>{item.fee || item.price} ر.س</span>
                  </div>
                ))}
              </div>
              
              <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span>المجموع الفرعي:</span>
                  <span>{selectedInvoice.subtotal} ر.س</span>
                </div>
                {selectedInvoice.discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>الخصم:</span>
                    <span>-{selectedInvoice.discount} ر.س</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>الضريبة (15%):</span>
                  <span>{selectedInvoice.vat_amount} ر.س</span>
                </div>
                <div className="flex justify-between font-bold text-lg pt-2 border-t">
                  <span>الإجمالي:</span>
                  <span>{selectedInvoice.total} ر.س</span>
                </div>
              </div>
              
              <Button 
                className="w-full gap-2 bg-purple-600 hover:bg-purple-700"
                onClick={() => handleDownloadPDF(selectedInvoice)}
              >
                <Download className="w-4 h-4" />
                تحميل PDF
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </MemberLayout>
  );
};

export default MemberInvoices;
