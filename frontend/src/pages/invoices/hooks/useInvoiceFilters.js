/**
 * useInvoiceFilters Hook
 * Hook for managing invoice filters and search
 */
import { useState, useMemo, useCallback } from 'react';

export const useInvoiceFilters = (invoices, registrationForms, creditNotes) => {
  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterActivity, setFilterActivity] = useState('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);

  // Filter invoices
  const filteredInvoices = useMemo(() => {
    return invoices.filter(invoice => {
      // Search term filter
      const searchMatch = !searchTerm || 
        invoice.invoice_number?.toString().includes(searchTerm) ||
        invoice.member_name_ar?.includes(searchTerm) ||
        invoice.member_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoice.customer_name_ar?.includes(searchTerm) ||
        invoice.member_code?.toString().includes(searchTerm);
      
      // Status filter
      const statusMatch = filterStatus === 'all' || invoice.status === filterStatus;
      
      // Activity filter
      const activityMatch = filterActivity === 'all' || 
        invoice.items?.some(item => item.activity_id === filterActivity);
      
      // Date range filter
      let dateMatch = true;
      if (filterStartDate) {
        dateMatch = dateMatch && invoice.created_at >= filterStartDate;
      }
      if (filterEndDate) {
        dateMatch = dateMatch && invoice.created_at <= filterEndDate + 'T23:59:59';
      }
      
      return searchMatch && statusMatch && activityMatch && dateMatch;
    });
  }, [invoices, searchTerm, filterStatus, filterActivity, filterStartDate, filterEndDate]);

  // Filter registration forms
  const filteredRegForms = useMemo(() => {
    return registrationForms.filter(form => {
      const searchMatch = !searchTerm ||
        form.form_number?.toString().includes(searchTerm) ||
        form.customer_name?.includes(searchTerm) ||
        form.customer_phone?.includes(searchTerm);
      
      const statusMatch = filterStatus === 'all' || form.status === filterStatus;
      
      return searchMatch && statusMatch;
    });
  }, [registrationForms, searchTerm, filterStatus]);

  // Filter credit notes
  const filteredCreditNotes = useMemo(() => {
    return creditNotes.filter(note => {
      const searchMatch = !searchTerm ||
        note.credit_note_number?.toString().includes(searchTerm) ||
        note.invoice_number?.toString().includes(searchTerm) ||
        note.member_name_ar?.includes(searchTerm);
      
      return searchMatch;
    });
  }, [creditNotes, searchTerm]);

  // Reset filters
  const resetFilters = useCallback(() => {
    setSearchTerm('');
    setFilterStatus('all');
    setFilterActivity('all');
    setFilterStartDate('');
    setFilterEndDate('');
  }, []);

  return {
    // States
    searchTerm,
    filterStatus,
    filterActivity,
    filterStartDate,
    filterEndDate,
    showAdvancedSearch,
    
    // Setters
    setSearchTerm,
    setFilterStatus,
    setFilterActivity,
    setFilterStartDate,
    setFilterEndDate,
    setShowAdvancedSearch,
    
    // Filtered data
    filteredInvoices,
    filteredRegForms,
    filteredCreditNotes,
    
    // Functions
    resetFilters,
  };
};

export default useInvoiceFilters;
