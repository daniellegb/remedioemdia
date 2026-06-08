import React, { useState } from 'react';
import { ArrowLeft, Lock, Eye, EyeOff, CheckCircle2, AlertTriangle, Key, Check, X, Smile } from 'lucide-react';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/hooks/useAuth';
import { ViewType } from '../types';
import { motion } from 'motion/react';

interface Props {
  setView: (view: ViewType) => void;
}

const Security: React.FC<Props> = ({ setView }) => {
  const { user, signOut, profile, refreshProfile } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSessionExpired, setIsSessionExpired] = useState(false);

  // Account deletion states
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // User type helper classifications
  const plan = profile?.plan || 'free';
  const subscriptionStatus = profile?.subscription_status || 'expired';
  const accountStatus = profile?.account_status || 'active';

  const isPremiumActive = plan === 'premium' && 
    (subscriptionStatus === 'active' || subscriptionStatus === 'trial');
  const isPremiumCanceled = plan === 'premium' && subscriptionStatus === 'canceled';
  const isPendingDeletion = accountStatus === 'pending_deletion';

  const formatBrazilianDate = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      // Construct date string formatted with DD/MM/YYYY in standard UTC-centric representation
      const localDay = String(date.getUTCDate()).padStart(2, '0');
      const localMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
      const year = date.getUTCFullYear();
      return `${localDay}/${localMonth}/${year}`;
    } catch (e) {
      return dateStr || '';
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    setDeleteError(null);
    setDeleteSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        throw new Error('Sessão expirada. Por favor, faça login novamente.');
      }

      const response = await fetch('/api/user/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'delete' })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Erro ao processar exclusão da conta.');
      }

      if (result.status === 'deleted') {
        setDeleteSuccess('Sua conta foi excluída com sucesso! Você será deslogado em instantes...');
        setTimeout(async () => {
          try {
            await signOut();
          } catch {
            localStorage.clear();
          }
          window.location.href = '/login';
        }, 3000);
      } else if (result.status === 'scheduled') {
        const dStr = formatBrazilianDate(result.scheduled_deletion_at);
        setDeleteSuccess(`Sua solicitação de exclusão de conta foi agendada com sucesso para ${dStr}! Você será deslogado automatica e imediatamente.`);
        setTimeout(async () => {
          try {
            await signOut();
          } catch {
            localStorage.clear();
          }
          window.location.href = '/login';
        }, 4000);
      }
    } catch (err: any) {
      console.error('[DeleteAccountFlow] Erro:', err);
      setDeleteError(err?.message || 'Ocorreu um erro ao excluir a conta. Por favor, tente novamente.');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleCancelDeletion = async () => {
    setDeleteLoading(true);
    setDeleteError(null);
    setDeleteSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        throw new Error('Sessão expirada. Por favor, faça login novamente.');
      }

      const response = await fetch('/api/user/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'cancel' })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Erro ao cancelar agendamento de exclusão.');
      }

      setDeleteSuccess('Agendamento de exclusão de conta cancelado com sucesso!');
      setShowCancelConfirm(false);
      
      // Update local profile representation
      await refreshProfile();
    } catch (err: any) {
      console.error('[CancelDeletionFlow] Erro:', err);
      setDeleteError(err?.message || 'Ocorreu um erro ao cancelar a exclusão. Por favor, tente novamente.');
    } finally {
      setDeleteLoading(false);
    }
  };

  // Check if user is authenticated via Google provider
  const isGoogleUser = user?.app_metadata?.provider === 'google' || 
                       (user?.identities && user.identities.some((identity: any) => identity.provider === 'google'));

  // Password rules validation states
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const passwordsMatch = password === confirmPassword && password !== '';

  const isFormValid = hasMinLength && hasUppercase && hasLowercase && hasNumber && passwordsMatch;

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) {
      if (!hasMinLength) {
        setError('A senha precisa ter pelo menos 8 caracteres.');
        return;
      }
      if (!hasUppercase) {
        setError('A senha precisa ter pelo menos 1 letra maiúscula.');
        return;
      }
      if (!hasLowercase) {
        setError('A senha precisa ter pelo menos 1 letra minúscula.');
        return;
      }
      if (!hasNumber) {
        setError('A senha precisa ter pelo menos 1 número.');
        return;
      }
      if (!passwordsMatch) {
        setError('As senhas não coincidem.');
        return;
      }
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    // Safety fallback: guaranteed to stop loading state in 2.5 seconds max
    const safetyTimer = setTimeout(() => {
      console.warn('[Security] Safety timer reached, forcing loading state to false');
      setLoading(false);
    }, 2500);

    try {
      console.log(`[Security] Tentando ${isGoogleUser ? 'definir' : 'alterar'} a senha via REST API direta...`);
      
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const token = currentSession?.access_token;
      
      if (!token) {
        throw new Error('Sessão ativa não encontrada. Por favor, faça login novamente.');
      }

      // Grab Supabase URL and Anon Key from environment
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Configurações do Supabase não encontradas.');
      }

      // Standard HTTP PUT to the GoTrue /user endpoint to update user attributes (including password)
      const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ password: password })
      });

      // Clear the safety timer as our request has completed
      clearTimeout(safetyTimer);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error_description || errorData.message || errorData.msg || 'Erro na resposta do servidor.');
      }

      const updatedUserData = await response.json();
      console.log('[Security] Senha salva com sucesso via REST API:', updatedUserData);

      // Attempt to silently refresh session in client to sync local memory safely
      try {
        await supabase.auth.refreshSession();
      } catch (refreshErr) {
        console.warn('[Security] Erro não-bloqueante ao atualizar sessão local:', refreshErr);
      }

      setSuccess(true);
      setPassword('');
      setConfirmPassword('');
      // Set loading to false immediately to allow UI updates to render without batching delays
      setLoading(false);

      // Redirect back to settings after 3 seconds
      setTimeout(() => {
        setView('settings');
      }, 3000);
    } catch (err: any) {
      clearTimeout(safetyTimer);
      console.error('[Security] Erro ao atualizar senha:', err);
      
      const errorMsg = err?.message || String(err);
      if (errorMsg.includes('session_id') || errorMsg.includes('JWT') || errorMsg.includes('Session from session_id')) {
        setIsSessionExpired(true);
        setError('Sua sessão de login expirou ou foi invalidada no banco de dados. Para sua segurança, é necessário sair e entrar novamente.');
      } else {
        setError(errorMsg || 'Ocorreu um erro ao alterar sua senha. Por favor, tente novamente.');
      }
      setLoading(false);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } }
  };

  return (
    <motion.div 
      id="security-page-container"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className="space-y-6 pb-20 md:pb-0 max-w-2xl mx-auto"
    >
      {/* Header with Back button */}
      <div className="flex items-center gap-4">
        <button 
          id="btn-back-to-settings"
          onClick={() => setView('settings')}
          className="p-2.5 bg-white hover:bg-slate-50 border border-slate-100 rounded-2xl text-slate-500 hover:text-slate-800 transition-colors shadow-sm cursor-pointer"
          title="Voltar para Ajustes"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">Segurança</h2>
          <p className="text-xs md:text-sm text-slate-500">Gerencie a segurança da sua conta e credenciais</p>
        </div>
      </div>

      {success && (
        <div id="security-success-banner" className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-emerald-800 text-sm flex gap-3 items-start animate-in fade-in slide-in-from-top-1 duration-300">
          <CheckCircle2 className="text-emerald-500 shrink-0 mt-0.5" size={18} />
          <div>
            <p className="font-semibold">
              {isGoogleUser ? 'Senha definida com sucesso!' : 'Senha alterada com sucesso!'}
            </p>
            <p className="text-xs mt-1 text-emerald-600/80 leading-relaxed">
              {isGoogleUser 
                ? 'Sua nova senha foi salva! Agora você também pode acessar sua conta usando e-mail e senha. Redirecionando para Ajustes em instantes...'
                : 'Sua nova senha foi salva com sucesso! Redirecionando para Ajustes em instantes...'
              }
            </p>
          </div>
        </div>
      )}

      {error && (
        <div id="security-error-banner" className="bg-red-50 border border-red-100 rounded-2xl p-4 text-red-700 text-sm flex gap-3 items-start animate-in fade-in slide-in-from-top-1 duration-300">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
          <div className="space-y-2 w-full">
            <p className="font-semibold">
              {isGoogleUser ? 'Não foi possível definir a senha' : 'Não foi possível alterar a senha'}
            </p>
            <p className="text-xs text-red-600/90 leading-relaxed">{error}</p>
            
            {isSessionExpired && (
              <div className="pt-2 border-t border-red-100 mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  id="btn-re-authenticate"
                  onClick={async () => {
                    setLoading(true);
                    try {
                      await signOut();
                    } catch (e) {
                      localStorage.clear();
                    }
                    window.location.href = '/login';
                  }}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs py-2 px-4 rounded-xl shadow-sm transition-all cursor-pointer active:scale-95"
                >
                  Sair e Entrar Novamente
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Change / Define Password Card */}
      <div id="security-password-card" className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
          <Key size={18} className="text-slate-400" />
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest text-slate-600">
            {isGoogleUser ? 'Definir Senha' : 'Alterar Senha'}
          </h3>
        </div>

        <div className="p-6 md:p-8 space-y-6">
          {isGoogleUser && (
            <div className="bg-blue-50/60 border border-blue-100/80 rounded-2xl p-4 text-blue-800 text-xs md:text-sm flex gap-3 items-start">
              <Smile className="text-blue-500 shrink-0 mt-0.5" size={18} />
              <div className="space-y-1">
                <p className="font-semibold">Você entrou com Google.</p>
                <p className="leading-normal text-slate-600 font-medium">
                  Defina uma senha caso também queira acessar com e-mail e senha além do login pelo Google.
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleUpdatePassword} className="space-y-6" id="form-change-password">
            {/* New Password Input */}
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700" htmlFor="new-password">
                Nova Senha
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl pl-4 pr-12 py-3.5 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm"
                  placeholder={isGoogleUser ? "Defina sua nova senha" : "Digite sua nova senha"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Confirm New Password Input */}
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700" htmlFor="confirm-new-password">
                Confirmar Nova Senha
              </label>
              <div className="relative">
                <input
                  id="confirm-new-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl pl-4 pr-12 py-3.5 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm"
                  placeholder="Confirme a nova senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Dynamic visual validations checklist */}
            <div className="bg-slate-50 rounded-2xl p-4 md:p-5 space-y-3 border border-slate-100">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Requisitos da senha</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2.5 text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <div className={`p-0.5 rounded-full ${hasMinLength ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'} transition-all`}>
                    <Check size={12} strokeWidth={3} />
                  </div>
                  <span className={hasMinLength ? 'text-slate-800 font-medium' : 'text-slate-400'}>Mínimo de 8 caracteres</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className={`p-0.5 rounded-full ${hasUppercase ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'} transition-all`}>
                    <Check size={12} strokeWidth={3} />
                  </div>
                  <span className={hasUppercase ? 'text-slate-800 font-medium' : 'text-slate-400'}>Pelo menos 1 letra maiúscula</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className={`p-0.5 rounded-full ${hasLowercase ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'} transition-all`}>
                    <Check size={12} strokeWidth={3} />
                  </div>
                  <span className={hasLowercase ? 'text-slate-800 font-medium' : 'text-slate-400'}>Pelo menos 1 letra minúscula</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className={`p-0.5 rounded-full ${hasNumber ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'} transition-all`}>
                    <Check size={12} strokeWidth={3} />
                  </div>
                  <span className={hasNumber ? 'text-slate-800 font-medium' : 'text-slate-400'}>Pelo menos 1 número</span>
                </div>

                <div className="flex items-center gap-2 md:col-span-2 pt-1 border-t border-slate-100 mt-1">
                  <div className={`p-0.5 rounded-full ${passwordsMatch ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'} transition-all`}>
                    <Check size={12} strokeWidth={3} />
                  </div>
                  <span className={passwordsMatch ? 'text-slate-800 font-medium' : 'text-slate-400'}>As senhas coincidem</span>
                </div>
              </div>
            </div>

            {/* Action Button */}
            <button
              id="btn-save-password"
              type="submit"
              disabled={loading || !isFormValid}
              className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-sm font-bold transition-all ${
                isFormValid && !loading
                  ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-100 active:scale-[0.99] cursor-pointer'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              {loading 
                ? (isGoogleUser ? 'Definindo senha...' : 'Alterando senha...') 
                : (isGoogleUser ? 'Definir Senha' : 'Alterar Senha')
              }
            </button>
          </form>
        </div>
      </div>

      {/* Account Deletion Panel Section */}
      {isPendingDeletion ? (
        <div id="security-scheduled-deletion-card" className="bg-amber-50 border border-amber-200 rounded-3xl p-6 md:p-8 space-y-4">
          <div className="flex gap-4 items-start">
            <AlertTriangle className="text-amber-500 shrink-0 mt-1" size={24} />
            <div className="space-y-3 w-full">
              <h3 className="text-base md:text-lg font-bold text-amber-900 leading-tight">Exclusão de Conta Pendente</h3>
              <p className="text-xs md:text-sm text-slate-600 leading-relaxed">
                Sua conta está agendada para exclusão em <span className="font-bold text-amber-900">{formatBrazilianDate(profile?.scheduled_deletion_at)}</span>.
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                Até essa data, seu acesso Premium permanecerá ativo e seus dados continuarão disponíveis. No dia agendado, a conta será apagada de forma definitiva e automática.
              </p>
              
              {deleteError && (
                <div className="text-xs text-red-600 bg-red-50 p-3 rounded-xl font-medium border border-red-100 flex gap-2 items-center">
                  <X size={14} className="shrink-0" />
                  <span>{deleteError}</span>
                </div>
              )}
              
              {deleteSuccess && (
                <div className="text-xs text-emerald-600 bg-emerald-50 p-3 rounded-xl font-medium border border-emerald-100 flex gap-2 items-center">
                  <Check size={14} className="shrink-0" />
                  <span>{deleteSuccess}</span>
                </div>
              )}

              {showCancelConfirm ? (
                <div className="bg-white border border-amber-100 rounded-2xl p-4 md:p-5 space-y-3 mt-3 shadow-xs">
                  <p className="text-xs md:text-sm font-bold text-slate-800 leading-tight">
                    Tem certeza que deseja cancelar a exclusão da conta?
                  </p>
                  <p className="text-xs text-slate-500 leading-normal">
                    Sua conta continuará ativa normalmente.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      id="btn-confirm-cancel-deletion"
                      disabled={deleteLoading}
                      onClick={handleCancelDeletion}
                      className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs py-2 px-4 rounded-xl shadow-xs transition-all cursor-pointer active:scale-95 text-center"
                    >
                      {deleteLoading ? 'Cancelando...' : 'Sim, cancelar exclusão'}
                    </button>
                    <button
                      type="button"
                      id="btn-close-cancel-deletion"
                      onClick={() => setShowCancelConfirm(false)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs py-2 px-4 rounded-xl transition-all cursor-pointer text-center"
                    >
                      Voltar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  id="btn-cancel-scheduled-deletion"
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteSuccess(null);
                    setShowCancelConfirm(true);
                  }}
                  className="mt-2 bg-white hover:bg-slate-100 border border-amber-200 text-amber-700 font-bold text-xs py-2 px-4 rounded-xl transition-all shadow-xs cursor-pointer active:scale-95 text-center inline-block"
                >
                  Cancelar exclusão
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div id="security-delete-account-card" className="bg-white rounded-3xl border border-red-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-red-50/50 border-b border-red-100/50 flex items-center gap-2">
            <AlertTriangle size={18} className="text-red-500" />
            <h3 className="text-sm font-bold text-red-600 uppercase tracking-widest">
              Excluir Conta
            </h3>
          </div>
          
          <div className="p-6 md:p-8 space-y-6">
            <p className="text-xs md:text-sm text-slate-500 leading-relaxed">
              Você pode excluir permanentemente sua conta de usuário a qualquer momento. Esta ação removerá totalmente seus dados de medicamentos, agendamentos e histórico de registros.
            </p>

            {deleteError && (
              <div id="delete-error-notice" className="text-xs md:text-sm text-red-600 bg-red-50 p-4 rounded-2xl border border-red-100 font-medium">
                {deleteError}
              </div>
            )}

            {deleteSuccess && (
              <div id="delete-success-notice" className="text-xs md:text-sm text-emerald-600 bg-emerald-50 p-4 rounded-2xl border border-emerald-100 font-medium">
                {deleteSuccess}
              </div>
            )}

            {isPremiumActive ? (
              <div className="bg-red-50/60 border border-red-100 rounded-2xl p-4 md:p-5 text-red-800 text-xs md:text-sm">
                <p className="font-semibold leading-relaxed">Não é possível excluir conta</p>
                <p className="mt-1 text-slate-600 leading-relaxed font-medium">
                  Você possui uma assinatura Premium ativa. Cancele sua assinatura primeiro. Após o cancelamento da renovação automática, a exclusão da conta ficará disponível.
                </p>
              </div>
            ) : showDeleteConfirm ? (
              <div className="bg-red-50/40 border border-red-100 p-5 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
                <p className="text-xs md:text-sm font-bold text-red-900 leading-tight">
                  {isPremiumCanceled 
                    ? 'Agendar exclusão de conta?' 
                    : 'Tem certeza que deseja excluir sua conta?'
                  }
                </p>
                
                <div className="text-xs md:text-sm text-slate-600 space-y-2 leading-relaxed">
                  {isPremiumCanceled ? (
                    <div className="space-y-3">
                      <p>
                        Sua assinatura permanece ativa até <span className="font-bold text-slate-900">{formatBrazilianDate(profile?.subscription_ends_at)}</span>.
                      </p>
                      <div className="space-y-1 bg-white p-3.5 rounded-xl border border-red-100/50">
                        <p className="font-semibold text-slate-800">Se continuar:</p>
                        <ul className="list-disc pl-4 space-y-1 text-xs text-slate-500 font-medium">
                          <li>sua conta será marcada para exclusão;</li>
                          <li>nenhum novo pagamento será realizado;</li>
                          <li>seus dados serão removidos automaticamente em {formatBrazilianDate(profile?.subscription_ends_at)}.</li>
                        </ul>
                      </div>
                      <p className="text-xs text-red-700 font-semibold">
                        Esta ação não poderá ser desfeita após a data programada.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p>
                        Esta ação é permanente e não poderá ser desfeita. Todos os medicamentos, lembretes, histórico de registros e compromissos salvos serão apagados definitivamente.
                      </p>
                      <div className="bg-white rounded-2xl p-4 text-xs text-slate-500 leading-relaxed border border-red-100/30">
                        Alguns registros relacionados a pagamentos poderão ser mantidos quando exigidos por obrigações legais, fiscais ou regulatórias.
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    id="btn-confirm-account-deletion"
                    disabled={deleteLoading}
                    onClick={handleDeleteAccount}
                    className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs py-2.5 px-5 rounded-xl shadow-xs transition-all cursor-pointer active:scale-95 text-center"
                  >
                    {deleteLoading ? 'Processando...' : isPremiumCanceled ? 'Confirmar Agendamento de Exclusão' : 'Confirmar Exclusão'}
                  </button>
                  <button
                    type="button"
                    id="btn-cancel-deletion-dialog"
                    onClick={() => setShowDeleteConfirm(false)}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs py-2.5 px-5 rounded-xl transition-all cursor-pointer active:scale-95 text-center"
                  >
                    Voltar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                id="btn-trigger-deletion-flow"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteSuccess(null);
                  setShowDeleteConfirm(true);
                }}
                className="w-full bg-red-50 hover:bg-red-100 text-red-600 font-bold py-4 rounded-2xl text-sm transition-all cursor-pointer border border-red-100 shadow-xs active:scale-[0.99] text-center"
              >
                Excluir conta
              </button>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default Security;
