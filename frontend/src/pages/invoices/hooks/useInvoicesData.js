/**
 * useInvoicesData Hook
 * Hook for managing invoices data and API calls
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { 
  invoicesAPI, membersAPI, activitiesAPI, productsAPI, 
  branchesAPI, registrationFormsAPI, creditNotesAPI, levelsAPI 
} from '../../../services/api';
import { toast } from 'sonner';

export const useInvoicesData = (t) => {
  const { selectedBranchId } = useAuth();
  
  // Data states
  const [invoices, setInvoices] = useState([]);
  const [members, setMembers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [products, setProducts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [levels, setLevels] = useState([]);
  const [registrationForms, setRegistrationForms] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);
  const [loading, setLoading] = useState(true);

  // Load all data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const branchParams = selectedBranchId && selectedBranchId !== 'all' 
        ? { branch_filter: selectedBranchId } 
        : {};
      
      const [
        invoicesRes, membersRes, activitiesRes, productsRes,
        branchesRes, regFormsRes, creditNotesRes, levelsRes
      ] = await Promise.all([
        invoicesAPI.getAll(branchParams),
        membersAPI.getAll(branchParams),
        activitiesAPI.getAll(),
        productsAPI.getAll(branchParams),
        branchesAPI.getAll(),
        registrationFormsAPI.getAll(branchParams),
        creditNotesAPI.getAll(branchParams),
        levelsAPI.getAll(branchParams)
      ]);

      setInvoices(invoicesRes.data);
      setMembers(membersRes.data);
      setActivities(activitiesRes.data);
      setProducts(productsRes.data);
      setBranches(branchesRes.data || []);
      setRegistrationForms(regFormsRes.data || []);
      setCreditNotes(creditNotesRes.data || []);
      setLevels(levelsRes.data || []);
    } catch (error) {
      toast.error(t('error'));
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, t]);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Get branch name
  const getBranchName = useCallback((branchId, language) => {
    if (!branchId) return language === 'ar' ? 'الفرع الرئيسي' : 'Main Branch';
    const branch = branches.find(b => b.id === branchId);
    return branch?.name_ar || branch?.name || branchId;
  }, [branches]);

  // Get member by ID
  const getMemberById = useCallback((memberId) => {
    return members.find(m => m.id === memberId);
  }, [members]);

  // Get activity by ID
  const getActivityById = useCallback((activityId) => {
    return activities.find(a => a.id === activityId);
  }, [activities]);

  // Get product by ID
  const getProductById = useCallback((productId) => {
    return products.find(p => p.id === productId);
  }, [products]);

  return {
    // Data
    invoices,
    members,
    activities,
    products,
    branches,
    levels,
    registrationForms,
    creditNotes,
    loading,
    
    // Setters
    setInvoices,
    setMembers,
    setRegistrationForms,
    setCreditNotes,
    
    // Functions
    loadData,
    getBranchName,
    getMemberById,
    getActivityById,
    getProductById,
  };
};

export default useInvoicesData;
