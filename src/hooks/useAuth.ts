import { useAuthContext } from '../context/AuthContext';

export const useAuth = () => {
  const { 
    user, 
    session, 
    profile, 
    loading, 
    signOut, 
    signIn,
    signUp,
    signInWithGoogle,
    isConfigured, 
    refreshProfile, 
    isAdmin, 
    isPremium 
  } = useAuthContext();

  return {
    user,
    session,
    loading,
    isAuthenticated: !!user,
    onboardingCompleted: profile?.onboarding_completed ?? false,
    profile,
    signOut,
    signIn,
    signUp,
    signInWithGoogle,
    isConfigured,
    refreshProfile,
    isAdmin,
    isPremium
  };
};
