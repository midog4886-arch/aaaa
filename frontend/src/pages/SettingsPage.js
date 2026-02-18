import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';
import { 
  Languages, 
  Moon,
  Sun,
  Trophy,
  Info,
  Download,
  Database,
  FolderArchive,
  Loader2
} from 'lucide-react';

export const SettingsPage = () => {
  const { t, language, toggleLanguage } = useLanguage();
  const [darkMode, setDarkMode] = React.useState(() => {
    return document.documentElement.classList.contains('dark');
  });
  const [backupLoading, setBackupLoading] = React.useState({
    code: false,
    database: false
  });

  const toggleDarkMode = () => {
    document.documentElement.classList.toggle('dark');
    setDarkMode(!darkMode);
    localStorage.setItem('theme', !darkMode ? 'dark' : 'light');
  };

  React.useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
      setDarkMode(true);
    }
  }, []);

  const API_URL = process.env.REACT_APP_BACKEND_URL || '';

  const downloadCodeBackup = async () => {
    setBackupLoading(prev => ({ ...prev, code: true }));
    try {
      const response = await fetch(`${API_URL}/api/backup/code`);
      if (!response.ok) throw new Error('Failed to download backup');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gcsp-academy-code-backup-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      
      toast.success(language === 'ar' ? 'تم تحميل النسخة الاحتياطية للكود' : 'Code backup downloaded successfully');
    } catch (error) {
      toast.error(language === 'ar' ? 'فشل تحميل النسخة الاحتياطية' : 'Failed to download backup');
    } finally {
      setBackupLoading(prev => ({ ...prev, code: false }));
    }
  };

  const downloadDatabaseBackup = async () => {
    setBackupLoading(prev => ({ ...prev, database: true }));
    try {
      const response = await fetch(`${API_URL}/api/backup/database`);
      if (!response.ok) throw new Error('Failed to download backup');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gcsp-academy-database-backup-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      
      toast.success(language === 'ar' ? 'تم تحميل النسخة الاحتياطية لقاعدة البيانات' : 'Database backup downloaded successfully');
    } catch (error) {
      toast.error(language === 'ar' ? 'فشل تحميل النسخة الاحتياطية' : 'Failed to download backup');
    } finally {
      setBackupLoading(prev => ({ ...prev, database: false }));
    }
  };

  return (
    <Layout title={t('settings')}>
      <div className="space-y-6 max-w-2xl" data-testid="settings-page">
        {/* Academy Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-primary" />
              {language === 'ar' ? 'معلومات الأكاديمية' : 'Academy Information'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-primary flex items-center justify-center">
                <Trophy className="w-8 h-8 text-primary-foreground" />
              </div>
              <div>
                <h3 className="text-xl font-bold">{t('academy_name')}</h3>
                <p className="text-muted-foreground">Champions Performance Academy</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 pt-4 border-t">
              <div>
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' ? 'العملة' : 'Currency'}
                </p>
                <p className="font-medium">{t('currency')} ({t('sar')})</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' ? 'الأنشطة' : 'Activities'}
                </p>
                <p className="font-medium">
                  {language === 'ar' 
                    ? 'السباحة، كرة القدم، الكاراتيه، الجمباز'
                    : 'Swimming, Football, Karate, Gymnastics'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Language Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Languages className="w-5 h-5 text-primary" />
              {t('language')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {language === 'ar' ? 'لغة الواجهة' : 'Interface Language'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' 
                    ? 'اختر اللغة المفضلة للواجهة'
                    : 'Select your preferred interface language'}
                </p>
              </div>
              <Button 
                variant="outline" 
                onClick={toggleLanguage}
                data-testid="toggle-language-btn"
              >
                {language === 'ar' ? 'English' : 'العربية'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Theme Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {darkMode ? <Moon className="w-5 h-5 text-primary" /> : <Sun className="w-5 h-5 text-primary" />}
              {t('theme')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {language === 'ar' ? 'الوضع الداكن' : 'Dark Mode'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' 
                    ? 'تفعيل أو تعطيل الوضع الداكن'
                    : 'Enable or disable dark mode'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Sun className="w-4 h-4 text-muted-foreground" />
                <Switch
                  checked={darkMode}
                  onCheckedChange={toggleDarkMode}
                  data-testid="toggle-theme-btn"
                />
                <Moon className="w-4 h-4 text-muted-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="w-5 h-5 text-primary" />
              {language === 'ar' ? 'عن النظام' : 'About'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {language === 'ar' 
                ? 'نظام إدارة شركة اداء الابطال العالمية للرياضة - نسخة 1.0'
                : 'Champions Performance Academy Management System - Version 1.0'}
            </p>
            <p className="text-sm text-muted-foreground">
              {language === 'ar' 
                ? 'تم التطوير بواسطة Emergent'
                : 'Developed by Emergent'}
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default SettingsPage;
