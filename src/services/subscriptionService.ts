// ⚠️ Nunca usar profile.plan diretamente para controle de acesso.
// Sempre usar hasPremiumAccess(profile)

import { supabase } from '../lib/supabase';
import { Profile } from '../../types';

const CACHE_KEY = 'med-remedio-subscription-cache';
const REVALIDATION_INTERVAL = 24 * 60 * 60 * 1000; // 24 horas

export const subscriptionService = {
  /**
   * Salva o estado da assinatura no cache local.
   */
  saveToCache(profile: Profile) {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    const cacheData = {
      plan: profile.plan,
      subscription_status: profile.subscription_status,
      trial_ends_at: profile.trial_ends_at,
      subscription_ends_at: profile.subscription_ends_at,
      lifetime_access: profile.lifetime_access,
      has_used_trial: profile.has_used_trial,
      stripe_customer_id: profile.stripe_customer_id,
      last_checked_at: new Date().getTime(),
    };
    localStorage.setItem(`${CACHE_KEY}_${profile.id}`, JSON.stringify(cacheData));
  },

  /**
   * Obtém o estado da assinatura do cache local.
   */
  getFromCache(userId: string) {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
    const cached = localStorage.getItem(`${CACHE_KEY}_${userId}`);
    if (!cached) return null;
    try {
      return JSON.parse(cached);
    } catch (e) {
      return null;
    }
  },

  /**
   * Inicia o trial de 7 dias para o usuário com proteção contra uso múltiplo.
   */
  async startTrial(userId: string): Promise<{ success: boolean; reason?: 'trial_already_used' | 'error'; profile?: Profile }> {
    // 1. Buscar perfil atual para verificar has_used_trial
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('has_used_trial')
      .eq('id', userId)
      .single();

    if (fetchError) {
      console.error('Erro ao buscar perfil para trial:', fetchError);
      return { success: false, reason: 'error' };
    }

    if (profile?.has_used_trial) {
      return { success: false, reason: 'trial_already_used' };
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);

    const { data, error } = await supabase
      .from('profiles')
      .update({
        subscription_status: 'trial',
        trial_ends_at: trialEndsAt.toISOString(),
        has_used_trial: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('Erro ao iniciar trial:', error);
      return { success: false, reason: 'error' };
    }
    
    const updatedProfile = data as Profile;
    this.saveToCache(updatedProfile);
    return { success: true, profile: updatedProfile };
  },

  /**
   * Verifica e atualiza o status de assinatura e trial do usuário.
   * Chamada login, abertura do app e sincronização.
   */
  async refreshSubscriptionStatus(profile: Profile): Promise<Profile> {
    const now = new Date();
    const cached = this.getFromCache(profile.id);
    
    // Se estivermos offline ou o cache for recente (menos de 24h), podemos usar o estado atual
    // mas ainda aplicamos a lógica de expiração local para segurança.
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const shouldRevalidate = !cached || (now.getTime() - cached.last_checked_at > REVALIDATION_INTERVAL);

    if (!isOnline || !shouldRevalidate) {
      // Aplicar lógica de expiração local baseada no que temos
      return this.applyLocalExpirationLogic(profile);
    }

    let updates: Partial<Profile> = {};

    // 1. Lifetime access nunca expira
    if (profile.lifetime_access || profile.plan === 'lifetime_access') {
      this.saveToCache(profile);
      return profile;
    }

    // 2. Verificar Trial
    if (profile.subscription_status === 'trial' && profile.trial_ends_at) {
      const trialEndsAt = new Date(profile.trial_ends_at);
      if (now > trialEndsAt) {
        updates = {
          plan: 'free',
          subscription_status: 'expired',
          updated_at: now.toISOString(),
        };
      }
    }

    // 3. Verificar Assinatura (Ativa ou Cancelada)
    // - active: renovável, expira se o período passou (falha de renovação/pagamento)
    // - canceled: cancelada manualmente, mantém acesso até subscription_ends_at
    if ((profile.subscription_status === 'active' || profile.subscription_status === 'canceled') && profile.subscription_ends_at) {
      const subscriptionEndsAt = new Date(profile.subscription_ends_at);
      if (now > subscriptionEndsAt) {
        updates = {
          plan: 'free',
          subscription_status: 'expired', // Se passou do tempo, ambos viram 'expired'
          updated_at: now.toISOString(),
        };
      }
    }

    // Se houver atualizações necessárias
    if (Object.keys(updates).length > 0) {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', profile.id)
        .select()
        .single();

      if (error) {
        console.error('Erro ao atualizar status de assinatura:', error);
        return this.applyLocalExpirationLogic(profile);
      }
      
      const updatedProfile = data as Profile;
      this.saveToCache(updatedProfile);
      return updatedProfile;
    }

    this.saveToCache(profile);
    return profile;
  },

  /**
   * Lógica de expiração baseada apenas nos dados do objeto (sem chamada ao DB).
   * Essencial para modo offline.
   */
  applyLocalExpirationLogic(profile: Profile): Profile {
    const now = new Date();
    
    if (profile.lifetime_access || profile.plan === 'lifetime_access') {
      return profile;
    }

    if (profile.subscription_status === 'trial' && profile.trial_ends_at) {
      if (now > new Date(profile.trial_ends_at)) {
        return { ...profile, plan: 'free', subscription_status: 'expired' };
      }
    }

    if ((profile.subscription_status === 'active' || profile.subscription_status === 'canceled') && profile.subscription_ends_at) {
      if (now > new Date(profile.subscription_ends_at)) {
        return { ...profile, plan: 'free', subscription_status: 'expired' };
      }
    }

    return profile;
  }
};
