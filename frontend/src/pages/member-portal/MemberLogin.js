import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Phone, LogIn, Trophy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';

const API_URL = process.env.REACT_APP_BACKEND_URL;

const MemberLogin = () => {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    
    if (!phone.trim()) {
      toast.error('يرجى إدخال رقم الجوال');
      return;
    }
    
    setLoading(true);
    
    try {
      const response = await axios.post(`${API_URL}/api/member-portal/login`, {
        phone: phone.trim()
      });
      
      // Save token and member data
      localStorage.setItem('member_token', response.data.access_token);
      localStorage.setItem('member_data', JSON.stringify(response.data.member));
      
      toast.success(`مرحباً ${response.data.member.name_ar}`);
      navigate('/portal/dashboard');
    } catch (error) {
      if (error.response?.status === 404) {
        toast.error('رقم الجوال غير مسجل في النظام');
      } else {
        toast.error('حدث خطأ في تسجيل الدخول');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4" dir="rtl">
      
      <Card className="w-full max-w-md relative bg-white/95 backdrop-blur shadow-2xl border-0">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-20 h-20 bg-gradient-to-br from-orange-500 to-amber-500 rounded-full flex items-center justify-center mb-4 shadow-lg">
            <Trophy className="w-10 h-10 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold text-gray-800">بوابة الأعضاء</CardTitle>
          <p className="text-gray-600 mt-2">أكاديمية أداء الأبطال العالمية</p>
        </CardHeader>
        
        <CardContent className="pt-6">
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">رقم الجوال</label>
              <div className="relative">
                <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="05xxxxxxxx"
                  className="pr-10 text-lg h-12 text-center tracking-wider"
                  dir="ltr"
                  data-testid="member-phone-input"
                />
              </div>
              <p className="text-xs text-gray-500 text-center">أدخل رقم الجوال المسجل في النظام</p>
            </div>
            
            <Button 
              type="submit" 
              className="w-full h-12 text-lg bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 gap-2"
              disabled={loading}
              data-testid="member-login-btn"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  دخول
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default MemberLogin;
