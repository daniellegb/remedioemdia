import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider } from './src/context/AuthContext';
import PrivateRoute from './src/components/PrivateRoute';
import Login from './src/pages/Login';
import MainApp from './src/components/MainApp';
import Onboarding from './src/components/Onboarding';
import { useAuth } from './src/hooks/useAuth';
import { supabase } from './src/lib/supabase';

const AppRoutes: React.FC = () => {
  const { refreshProfile, isConfigured } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isConfigured) return;

    const handleOAuthRedirect = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (data?.session) {
        // Session is handled by AuthContext's onAuthStateChange
        console.log('OAuth session detected');
      }
    };

    handleOAuthRedirect();
  }, [isConfigured]);

  const handleOnboardingComplete = async (skipMedication?: boolean) => {
    await refreshProfile();
    if (skipMedication) {
      navigate('/dashboard');
    } else {
      // Se quiser cadastrar o primeiro remédio, podemos passar um state ou algo assim
      // Por enquanto, vamos apenas para o dashboard e abrir o modal lá se possível
      // Ou apenas ir para o dashboard.
      navigate('/dashboard', { state: { openAddMed: true } });
    }
  };

  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<Login />} />

      {/* Private Routes */}
      <Route element={<PrivateRoute />}>
        <Route path="/dashboard" element={<MainApp />} />
        <Route path="/onboarding" element={<Onboarding onComplete={handleOnboardingComplete} />} />
      </Route>

      {/* Default Redirects */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
};

export default App;
