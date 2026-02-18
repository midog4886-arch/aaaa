import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { backupAPI } from '../services/api';
import { toast } from 'sonner';
import {
  Database,
  Download,
  Upload,
  Trash2,
  RefreshCcw,
  Loader2,
  HardDrive,
  Clock,
  AlertTriangle,
  Plus,
  Shield,
} from 'lucide-react';

const formatSize = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const formatDate = (dateStr) => {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
};

const BackupPage = () => {
  const { language } = useLanguage();
  const { user } = useAuth();
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [restoreDialog, setRestoreDialog] = useState({ open: false, filename: null });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, filename: null });

  const isAr = language === 'ar';

  useEffect(() => {
    loadBackups();
  }, []);

  const loadBackups = async () => {
    setLoading(true);
    try {
      const res = await backupAPI.list();
      setBackups(res.data?.backups || []);
    } catch (error) {
      console.error('Failed to load backups:', error);
      toast.error(isAr ? 'فشل في تحميل النسخ الاحتياطية' : 'Failed to load backups');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await backupAPI.create();
      toast.success(
        isAr
          ? `تم إنشاء نسخة احتياطية: ${res.data?.filename || ''}`
          : `Backup created: ${res.data?.filename || ''}`
      );
      await loadBackups();
    } catch (error) {
      console.error('Failed to create backup:', error);
      toast.error(isAr ? 'فشل في إنشاء النسخة الاحتياطية' : 'Failed to create backup');
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = (filename) => {
    const url = backupAPI.download(filename);
    window.open(url, '_blank');
  };

  const handleRestore = async () => {
    const { filename } = restoreDialog;
    if (!filename) return;
    setRestoring(true);
    try {
      const res = await backupAPI.restore(filename);
      const collections = res.data?.restored_collections || [];
      toast.success(
        isAr
          ? `تم استعادة النسخة الاحتياطية بنجاح (${collections.length} مجموعة)`
          : `Backup restored successfully (${collections.length} collections)`
      );
      setRestoreDialog({ open: false, filename: null });
    } catch (error) {
      console.error('Failed to restore backup:', error);
      toast.error(isAr ? 'فشل في استعادة النسخة الاحتياطية' : 'Failed to restore backup');
    } finally {
      setRestoring(false);
    }
  };

  const handleDelete = async () => {
    const { filename } = deleteDialog;
    if (!filename) return;
    setDeleting(true);
    try {
      await backupAPI.delete(filename);
      toast.success(isAr ? 'تم حذف النسخة الاحتياطية' : 'Backup deleted');
      setDeleteDialog({ open: false, filename: null });
      await loadBackups();
    } catch (error) {
      console.error('Failed to delete backup:', error);
      toast.error(isAr ? 'فشل في حذف النسخة الاحتياطية' : 'Failed to delete backup');
    } finally {
      setDeleting(false);
    }
  };

  const totalSize = backups.reduce((sum, b) => sum + (b.size || 0), 0);

  return (
    <Layout title={isAr ? 'النسخ الاحتياطي' : 'Database Backup'}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Database className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">
                {isAr ? 'النسخ الاحتياطي' : 'Database Backup'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {isAr ? 'إدارة النسخ الاحتياطية لقاعدة البيانات' : 'Manage database backups'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadBackups} disabled={loading}>
              <RefreshCcw className={`w-4 h-4 me-2 ${loading ? 'animate-spin' : ''}`} />
              {isAr ? 'تحديث' : 'Refresh'}
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? (
                <Loader2 className="w-4 h-4 me-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 me-2" />
              )}
              {isAr ? 'إنشاء نسخة احتياطية' : 'Create Backup'}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <Shield className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {isAr ? 'إجمالي النسخ' : 'Total Backups'}
                  </p>
                  <p className="text-2xl font-bold">{backups.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                  <HardDrive className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {isAr ? 'الحجم الإجمالي' : 'Total Size'}
                  </p>
                  <p className="text-2xl font-bold">{formatSize(totalSize)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" />
              {isAr ? 'قائمة النسخ الاحتياطية' : 'Backup List'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : backups.length === 0 ? (
              <div className="text-center py-12">
                <Database className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
                <p className="text-lg font-medium text-muted-foreground">
                  {isAr ? 'لا توجد نسخ احتياطية' : 'No backups found'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {isAr
                    ? 'قم بإنشاء أول نسخة احتياطية لحماية بياناتك'
                    : 'Create your first backup to protect your data'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {backups.map((backup, index) => (
                  <div
                    key={backup.filename || index}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Database className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{backup.filename}</p>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                          <span className="flex items-center gap-1">
                            <HardDrive className="w-3 h-3" />
                            {formatSize(backup.size)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDate(backup.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownload(backup.filename)}
                        title={isAr ? 'تحميل' : 'Download'}
                      >
                        <Download className="w-4 h-4 me-1" />
                        <span className="hidden sm:inline">
                          {isAr ? 'تحميل' : 'Download'}
                        </span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setRestoreDialog({ open: true, filename: backup.filename })
                        }
                        title={isAr ? 'استعادة' : 'Restore'}
                        className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                      >
                        <Upload className="w-4 h-4 me-1" />
                        <span className="hidden sm:inline">
                          {isAr ? 'استعادة' : 'Restore'}
                        </span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setDeleteDialog({ open: true, filename: backup.filename })
                        }
                        title={isAr ? 'حذف' : 'Delete'}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-4 h-4 me-1" />
                        <span className="hidden sm:inline">
                          {isAr ? 'حذف' : 'Delete'}
                        </span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={restoreDialog.open}
        onOpenChange={(open) => {
          if (!open) setRestoreDialog({ open: false, filename: null });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              {isAr ? 'تأكيد الاستعادة' : 'Confirm Restore'}
            </DialogTitle>
            <DialogDescription>
              {isAr
                ? 'تحذير: استعادة هذه النسخة الاحتياطية ستؤدي إلى استبدال جميع البيانات الحالية. هذا الإجراء لا يمكن التراجع عنه.'
                : 'Warning: Restoring this backup will replace all current data. This action cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
            <p className="text-sm font-medium">
              {isAr ? 'الملف:' : 'File:'} {restoreDialog.filename}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setRestoreDialog({ open: false, filename: null })}
              disabled={restoring}
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button
              onClick={handleRestore}
              disabled={restoring}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {restoring ? (
                <Loader2 className="w-4 h-4 me-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 me-2" />
              )}
              {isAr ? 'استعادة' : 'Restore'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteDialog.open}
        onOpenChange={(open) => {
          if (!open) setDeleteDialog({ open: false, filename: null });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              {isAr ? 'تأكيد الحذف' : 'Confirm Delete'}
            </DialogTitle>
            <DialogDescription>
              {isAr
                ? 'هل أنت متأكد من حذف هذه النسخة الاحتياطية؟ لا يمكن التراجع عن هذا الإجراء.'
                : 'Are you sure you want to delete this backup? This action cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20">
            <p className="text-sm font-medium">
              {isAr ? 'الملف:' : 'File:'} {deleteDialog.filename}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteDialog({ open: false, filename: null })}
              disabled={deleting}
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 me-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 me-2" />
              )}
              {isAr ? 'حذف' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

export default BackupPage;
