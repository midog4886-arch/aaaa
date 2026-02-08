import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Trophy, Loader2, Languages } from 'lucide-react';
import { seedAPI } from '../services/api';

export const LoginPage = () => {
  const { t, language, toggleLanguage } = useLanguage();
  const { login } = useAuth();
  const navigate = useNavigate();
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [seeding, setSeeding] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    const result = await login(username, password);
    
    if (result.success) {
      navigate('/dashboard');
    } else {
      setError(t('invalid_credentials'));
    }
    
    setLoading(false);
  };

  const handleSeedData = async () => {
    setSeeding(true);
    try {
      const response = await seedAPI.seed();
      if (response.data.admin_credentials) {
        setUsername(response.data.admin_credentials.username);
        setPassword(response.data.admin_credentials.password);
      }
      alert(language === 'ar' ? 'تم إنشاء البيانات التجريبية بنجاح' : 'Demo data created successfully');
    } catch (error) {
      console.error('Seed failed:', error);
    }
    setSeeding(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-800 p-4">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute inset-0" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />
      </div>

      <div className="w-full max-w-md relative">
        {/* Language Toggle */}
        <div className="absolute top-0 left-0 -translate-y-16">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleLanguage}
            className="bg-white/80 backdrop-blur"
          >
            <Languages className="w-4 h-4 me-2" />
            {language === 'ar' ? 'English' : 'العربية'}
          </Button>
        </div>

        <Card className="glass shadow-2xl border-0">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mb-4 shadow-lg">
              <Trophy className="w-8 h-8 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl font-bold">
              {t('login_welcome')}
            </CardTitle>
            <CardDescription className="text-lg font-semibold text-primary">
              {t('academy_name')}
            </CardDescription>
            <CardDescription className="mt-2">
              {t('login_subtitle')}
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm text-center">
                  {error}
                </div>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="username">{t('username')}</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('username')}
                  required
                  data-testid="login-username-input"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">{t('password')}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('password')}
                  required
                  data-testid="login-password-input"
                />
              </div>
              
              <Button 
                type="submit" 
                className="w-full"
                disabled={loading}
                data-testid="login-submit-btn"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 me-2 animate-spin" />
                    {t('loading')}
                  </>
                ) : (
                  t('login')
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LoginPage;
