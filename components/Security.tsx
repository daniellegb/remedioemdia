import React, { useState } from 'react';
import { ArrowLeft, Lock, Eye, EyeOff, CheckCircle2, AlertTriangle, Key, Check, X } from 'lucide-react';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/hooks/useAuth';
import { ViewType } from '../types';
import { motion } from 'motion/react';

interface Props {
  setView: (view: ViewType) => void;
}

const Security: React.FC<Props> = ({ setView }) => {
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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

    try {
      console.log('[Security] Tentando alterar a senha usando supabase auth...');
      const { error: authError } = await supabase.auth.updateUser({
        password: password
      });

      if (authError) {
        throw authError;
      }

      setSuccess(true);
      setPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      console.error('[Security] Erro ao atualizar senha via Supabase Auth:', err);
      setError(err?.message || 'Ocorreu um erro ao alterar sua senha. Por favor, tente novamente.');
    } finally {
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
            <p className="font-semibold">Senha alterada com sucesso.</p>
            <p className="text-xs mt-0.5 text-emerald-600/80">Sua nova senha de acesso já está em vigor para as próximas sessões.</p>
          </div>
        </div>
      )}

      {error && (
        <div id="security-error-banner" className="bg-red-50 border border-red-100 rounded-2xl p-4 text-red-700 text-sm flex gap-3 items-start animate-in fade-in slide-in-from-top-1 duration-300">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
          <div>
            <p className="font-semibold">Não foi possível alterar a senha</p>
            <p className="text-xs mt-0.5 text-red-600/80">{error}</p>
          </div>
        </div>
      )}

      {/* Change Password Card */}
      <div id="security-password-card" className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
          <Key size={18} className="text-slate-400" />
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Alterar Senha</h3>
        </div>

        <div className="p-6 md:p-8 space-y-6">
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
                  placeholder="Digite sua nova senha"
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
              {loading ? 'Alterando senha...' : 'Alterar Senha'}
            </button>
          </form>
        </div>
      </div>
    </motion.div>
  );
};

export default Security;
