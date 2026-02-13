/**
 * Invoice Filters Component
 * Search and filter controls for invoices
 */
import React from 'react';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Search, Filter, X, RefreshCcw } from 'lucide-react';

const InvoiceFilters = ({
  searchTerm,
  setSearchTerm,
  filterStatus,
  setFilterStatus,
  filterActivity,
  setFilterActivity,
  filterStartDate,
  setFilterStartDate,
  filterEndDate,
  setFilterEndDate,
  showAdvancedSearch,
  setShowAdvancedSearch,
  activities,
  onRefresh,
  language = 'ar'
}) => {
  const statusOptions = [
    { value: 'all', label: language === 'ar' ? 'جميع الحالات' : 'All Status' },
    { value: 'paid', label: language === 'ar' ? 'مدفوعة' : 'Paid' },
    { value: 'pending', label: language === 'ar' ? 'معلقة' : 'Pending' },
    { value: 'cancelled', label: language === 'ar' ? 'ملغية' : 'Cancelled' },
  ];

  const handleReset = () => {
    setSearchTerm('');
    setFilterStatus('all');
    setFilterActivity('all');
    setFilterStartDate('');
    setFilterEndDate('');
  };

  return (
    <div className="space-y-4">
      {/* Main Search Row */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder={language === 'ar' ? 'بحث برقم الفاتورة، اسم العضو، رقم الهاتف...' : 'Search by invoice number, member name, phone...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pr-10"
            data-testid="invoice-search-input"
          />
        </div>

        {/* Status Filter */}
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[150px]" data-testid="invoice-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Toggle Advanced Search */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
          className="gap-2"
        >
          <Filter className="w-4 h-4" />
          {language === 'ar' ? 'بحث متقدم' : 'Advanced'}
        </Button>

        {/* Refresh Button */}
        <Button
          variant="outline"
          size="icon"
          onClick={onRefresh}
          title={language === 'ar' ? 'تحديث' : 'Refresh'}
        >
          <RefreshCcw className="w-4 h-4" />
        </Button>
      </div>

      {/* Advanced Search Options */}
      {showAdvancedSearch && (
        <div className="p-4 bg-gray-50 rounded-lg border space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {/* Activity Filter */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">
                {language === 'ar' ? 'النشاط' : 'Activity'}
              </label>
              <Select value={filterActivity} onValueChange={setFilterActivity}>
                <SelectTrigger data-testid="invoice-activity-filter">
                  <SelectValue placeholder={language === 'ar' ? 'جميع الأنشطة' : 'All Activities'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {language === 'ar' ? 'جميع الأنشطة' : 'All Activities'}
                  </SelectItem>
                  {activities.map(activity => (
                    <SelectItem key={activity.id} value={activity.id}>
                      {language === 'ar' ? activity.name_ar : activity.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Start Date */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">
                {language === 'ar' ? 'من تاريخ' : 'From Date'}
              </label>
              <Input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
              />
            </div>

            {/* End Date */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">
                {language === 'ar' ? 'إلى تاريخ' : 'To Date'}
              </label>
              <Input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
              />
            </div>

            {/* Reset Button */}
            <div className="flex items-end">
              <Button
                variant="ghost"
                onClick={handleReset}
                className="gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <X className="w-4 h-4" />
                {language === 'ar' ? 'مسح الفلاتر' : 'Clear Filters'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoiceFilters;
