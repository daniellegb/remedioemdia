import React, { useState, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const PrivateRoute: React.FC = () => {
  const { isAuthenticated, onboardingCompleted, loading, profileLoaded } = useAuth();
  const location = useLocation();
  const [isStuck, setIsStuck] = useState(false);

  // Consideramos carregando se o auth inicial não terminou 
  // OU se o usuário está logado mas o perfil ainda não foi carregado/resolvido
  const isAuthWaiting = loading || (isAuthenticated && !profileLoaded);

  useEffect(() => {
    let timer: number;
    if (isAuthWaiting) {
      timer = window.setTimeout(() => {
        // Tenta auto-reset uma vez por sessão
        const autoResetDone = sessionStorage.getItem('auto_reset_auth_stuck');
        if (!autoResetDone) {
          sessionStorage.setItem('auto_reset_auth_stuck', 'true');
          console.warn('[Watchdog] Autenticação/Perfil demorando muito. Limpando cache local...');
          localStorage.clear();
          window.location.reload();
        } else {
          setIsStuck(true);
        }
      }, 5000); // 5 segundos de tolerância para autenticação e perfil
    } else {
      setIsStuck(false);
    }
    return () => window.clearTimeout(timer);
  }, [isAuthWaiting]);

  if (isAuthWaiting) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-6"></div>
        <p className="text-slate-500 font-bold text-sm mb-8 animate-pulse font-mono uppercase tracking-widest">Carregando...</p>
        {isStuck && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-xs">
            <p className="text-sm text-slate-500 mb-4 font-medium italic">O carregamento está demorando mais que o esperado.</p>
            <button 
              onClick={() => {
                localStorage.clear();
                sessionStorage.clear();
                window.location.reload();
              }}
              className="w-full px-6 py-4 bg-white border-2 border-slate-200 text-slate-600 rounded-[24px] font-bold shadow-sm hover:bg-slate-50 active:scale-95 transition-all"
            >
              Sair e Reiniciar
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Se o onboarding não foi concluído e não estamos na página de onboarding, redireciona
  if (!onboardingCompleted && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  // Se o onboarding já foi concluído e estamos na página de onboarding, 
  // deixamos o componente Onboarding lidar com a navegação final para preservar o estado (ex: abrir cadastro de remédio)
  return <Outlet />;
};

export default PrivateRoute;
