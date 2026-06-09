import React, { useEffect, useState } from 'react';
import { Smartphone, Tablet, Monitor, Laptop, Trash2, ShieldAlert, CheckCircle, RefreshCw, AlertCircle, ChevronLeft } from 'lucide-react';
import { useAuth } from '../src/hooks/useAuth';
import { sessionService } from '../src/services/sessionService';
import { ActiveSession } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface ActiveSessionsProps {
  onBack: () => void;
}

export const ActiveSessions: React.FC<ActiveSessionsProps> = ({ onBack }) => {
  const { currentSessionId } = useAuth();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modal / Selection State
  const [sessionToRevoke, setSessionToRevoke] = useState<ActiveSession | null>(null);
  const [showConfirmAllModal, setShowConfirmAllModal] = useState(false);

  const fetchSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await sessionService.listSessions();
      setSessions(data);
    } catch (err: any) {
      console.error('[ActiveSessions] Error loading sessions:', err);
      setError('Não foi possível carregar as sessões ativas. Verifique sua conexão com a internet.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const formatRelativeTime = (dateStr: string): string => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      
      if (diffMs < 0) return 'agora';
      
      const diffSecs = Math.floor(diffMs / 1000);
      if (diffSecs < 15) return 'agora';
      if (diffSecs < 60) return 'há menos de um minuto';
      
      const diffMins = Math.floor(diffSecs / 60);
      if (diffMins < 60) {
        return diffMins === 1 ? 'há 1 minuto' : `há ${diffMins} minutos`;
      }
      
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) {
        return diffHours === 1 ? 'há 1 hora' : `há ${diffHours} horas`;
      }
      
      const diffDays = Math.floor(diffHours / 24);
      return diffDays === 1 ? 'há 1 dia' : `há ${diffDays} dias`;
    } catch (e) {
      return 'algum tempo';
    }
  };

  const getDeviceIcon = (deviceType: string) => {
    switch (deviceType.toLowerCase()) {
      case 'iphone':
      case 'android':
      case 'mobile':
        return <Smartphone className="text-slate-500" size={22} />;
      case 'tablet':
        return <Tablet className="text-slate-500" size={22} />;
      case 'desktop':
        return <Monitor className="text-slate-500" size={22} />;
      default:
        return <Laptop className="text-slate-500" size={22} />;
    }
  };

  const handleRevokeSingle = async () => {
    if (!sessionToRevoke) return;
    setActionLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await sessionService.revokeSession(sessionToRevoke.session_id);
      setSuccess(`A sessão no dispositivo (${sessionToRevoke.browser} — ${sessionToRevoke.os}) foi desconectada com sucesso.`);
      setSessionToRevoke(null);
      await fetchSessions();
    } catch (err: any) {
      console.error('[ActiveSessions] Error revoking session:', err);
      setError('Ocorreu um erro ao tentar desconectar o dispositivo remoto. Tente novamente.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevokeAllOthers = async () => {
    if (!currentSessionId) return;
    setActionLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await sessionService.revokeAllOtherSessions(currentSessionId);
      setSuccess('Todos os outros dispositivos conectados foram desconectados da sua conta.');
      setShowConfirmAllModal(false);
      await fetchSessions();
    } catch (err: any) {
      console.error('[ActiveSessions] Error revoking all except current:', err);
      setError('Falha ao desconectar outras sessões. Verifique sua conexão e tente de novo.');
    } finally {
      setActionLoading(false);
    }
  };

  const hasMultipleSessions = sessions.length > 1;

  return (
    <div id="active-sessions-screen" className="space-y-6">
      {/* Sub Header */}
      <div className="flex items-center gap-4">
        <button 
          id="btn-back-to-security-main"
          onClick={onBack}
          className="p-2.5 bg-white hover:bg-slate-50 border border-slate-100 rounded-2xl text-slate-500 hover:text-slate-800 transition-colors shadow-sm cursor-pointer active:scale-95 duration-100"
          title="Voltar"
        >
          <ChevronLeft size={20} />
        </button>
        <div>
          <h2 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight">Dispositivos e Sessões Ativas</h2>
          <p className="text-xs text-slate-500">Gerencie e desconecte as sessões ativas da sua conta</p>
        </div>
      </div>

      {/* Alert Notices */}
      {success && (
        <div id="sessions-success-banner" className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-emerald-800 text-sm flex gap-3 items-start animate-in fade-in slide-in-from-top-1 duration-300">
          <CheckCircle className="text-emerald-500 shrink-0 mt-0.5" size={18} />
          <div className="w-full">
            <p className="font-semibold">Ação Concluída</p>
            <p className="text-xs text-emerald-600/90 leading-relaxed mt-0.5">{success}</p>
          </div>
        </div>
      )}

      {error && (
        <div id="sessions-error-banner" className="bg-red-50 border border-red-100 rounded-2xl p-4 text-red-700 text-sm flex gap-3 items-start animate-in fade-in slide-in-from-top-1 duration-300">
          <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
          <div className="w-full">
            <p className="font-semibold">Erro ao processar solicitação</p>
            <p className="text-xs text-red-600/90 leading-relaxed mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Main card */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Dispositivos Conectados</span>
          <button 
            type="button" 
            onClick={fetchSessions} 
            disabled={loading}
            className="p-1.5 hover:bg-slate-200 text-slate-500 hover:text-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Atualizar lista"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {loading ? (
          /* Loading Skeletons */
          <div className="p-6 md:p-8 space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="flex gap-4 p-4 border border-slate-100 rounded-2xl animate-pulse">
                <div className="w-12 h-12 bg-slate-100 rounded-xl shrink-0" />
                <div className="space-y-2 w-full">
                  <div className="h-4 bg-slate-100 rounded-md w-1/3" />
                  <div className="h-3 bg-slate-100 rounded-md w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 md:p-8 space-y-4">
            {sessions.map((sess) => {
              const isCurrent = sess.session_id === currentSessionId;
              
              return (
                <div 
                  key={sess.id}
                  id={`session-item-${sess.id}`}
                  className={`flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 md:p-5 rounded-2xl border transition-all ${
                    isCurrent 
                      ? 'border-blue-100 bg-blue-50/20 shadow-xs' 
                      : 'border-slate-100 hover:border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex gap-4 items-start">
                    <div className={`p-3 rounded-xl shrink-0 ${isCurrent ? 'bg-blue-100/50 text-blue-600' : 'bg-slate-50 text-slate-600'}`}>
                      {getDeviceIcon(sess.device_type)}
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm md:text-base font-bold text-slate-800 flex items-center gap-2">
                        {sess.browser} — {sess.os}
                        {isCurrent && (
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] md:text-xs font-bold px-2 py-0.5 rounded-full ring-1 ring-emerald-200/50 select-none shrink-0" id="badge-current-session">
                            Sessão atual
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 font-medium">
                        Última atividade: <span className="font-semibold text-slate-600">{formatRelativeTime(sess.last_activity)}</span>
                      </p>
                    </div>
                  </div>

                  {!isCurrent && (
                    <button
                      type="button"
                      id={`btn-revoke-session-${sess.id}`}
                      onClick={() => setSessionToRevoke(sess)}
                      className="mt-3 sm:mt-0 flex items-center justify-center gap-1.5 align-middle self-end sm:self-auto bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs py-2 px-3.5 rounded-xl cursor-pointer transition-all active:scale-95"
                    >
                      <Trash2 size={13} />
                      Encerrar sessão
                    </button>
                  )}
                </div>
              );
            })}

            {!hasMultipleSessions && !loading && (
              <div id="notice-single-session" className="bg-slate-50 border border-slate-100 rounded-2xl p-4 text-slate-600 text-xs md:text-sm text-center font-medium leading-relaxed">
                Você está conectado apenas neste dispositivo.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bulk Logout Button */}
      {hasMultipleSessions && !loading && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            id="btn-revoke-all-others-dialog"
            onClick={() => setShowConfirmAllModal(true)}
            className="w-full sm:w-auto bg-slate-900 text-white font-bold py-3.5 px-6 rounded-2xl text-sm transition-all shadow-sm hover:bg-slate-800 cursor-pointer text-center active:scale-95 flex items-center justify-center gap-2"
          >
            <Trash2 size={16} />
            Encerrar todas as outras sessões
          </button>
        </div>
      )}

      {/* Confirmation Modal: Single Session Revoke */}
      <AnimatePresence>
        {sessionToRevoke && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSessionToRevoke(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs" 
            />

            {/* Modal Body */}
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="relative bg-white rounded-3xl p-6 max-w-sm w-full border border-slate-100 shadow-xl space-y-4"
              id="confirm-single-revoke-modal"
            >
              <div className="flex items-center gap-3 text-red-600">
                <div className="p-2.5 bg-red-50 rounded-2xl">
                  <ShieldAlert size={24} />
                </div>
                <h3 className="text-base font-bold text-slate-900">Encerrar Sessão?</h3>
              </div>

              <p className="text-xs md:text-sm text-slate-500 leading-relaxed font-medium">
                Tem certeza que deseja desconectar o dispositivo <span className="font-bold text-slate-800">{sessionToRevoke.browser} ({sessionToRevoke.os})</span>? A sessão será invalidada imediatamente e o dispositivo será desconectado da sua conta.
              </p>

              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  id="btn-confirm-revoke-single"
                  disabled={actionLoading}
                  onClick={handleRevokeSingle}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-xl cursor-pointer text-xs transition-all active:scale-95 text-center"
                >
                  {actionLoading ? 'Processando...' : 'Desconectar'}
                </button>
                <button
                  type="button"
                  id="btn-cancel-revoke-single"
                  onClick={() => setSessionToRevoke(null)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2.5 rounded-xl transition-all cursor-pointer text-xs text-center"
                >
                  Voltar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal: Revoke All Others */}
      <AnimatePresence>
        {showConfirmAllModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowConfirmAllModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs" 
            />

            {/* Modal Body */}
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="relative bg-white rounded-3xl p-6 max-w-sm w-full border border-slate-100 shadow-xl space-y-4"
              id="confirm-bulk-revoke-modal"
            >
              <div className="flex items-center gap-3 text-red-600">
                <div className="p-2.5 bg-red-50 rounded-2xl">
                  <ShieldAlert size={24} />
                </div>
                <h3 className="text-base font-bold text-slate-900">Encerrar Outras Sessões?</h3>
              </div>

              <p className="text-xs md:text-sm text-slate-500 leading-relaxed font-medium">
                Esta ação vai desligar e invalidar **todas as outras sessões** em computadores, celulares e tablets atualmente conectados à sua conta, mantendo apenas esta sessão atual ativa. Confirma o encerramento?
              </p>

              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  id="btn-confirm-revoke-all-others"
                  disabled={actionLoading}
                  onClick={handleRevokeAllOthers}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-xl cursor-pointer text-xs transition-all active:scale-95 text-center"
                >
                  {actionLoading ? 'Processando...' : 'Sim, desconectar todos'}
                </button>
                <button
                  type="button"
                  id="btn-cancel-revoke-all-others"
                  onClick={() => setShowConfirmAllModal(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2.5 rounded-xl transition-all cursor-pointer text-xs text-center"
                >
                  Voltar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ActiveSessions;
