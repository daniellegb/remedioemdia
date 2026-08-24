import { supabase } from '../lib/supabase';
import { Profile, UserPreferences } from '../../types';
import { validateStringLength } from '../domain/validation';

export const onboardingService = {
  async updateProfile(profile: Partial<Profile> & { id: string }) {
    const sanitized: any = { ...profile };
    if (profile.name !== undefined) sanitized.name = validateStringLength(profile.name, 'Nome', 100, false);
    if (profile.caregiver_name !== undefined) sanitized.caregiver_name = validateStringLength(profile.caregiver_name, 'Nome do cuidador', 100, false);
    if (profile.patient_name !== undefined) sanitized.patient_name = validateStringLength(profile.patient_name, 'Nome do paciente', 100, false);

    const { data, error } = await supabase
      .from('profiles')
      .upsert(sanitized);

    if (error) throw error;
    return data;
  },

  async upsertPreferences(preferences: Partial<UserPreferences> & { user_id: string }) {
    const { data, error } = await supabase
      .from('user_preferences')
      .upsert(preferences, { onConflict: 'user_id' });

    if (error) throw error;
    return data;
  },

  async getProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return data as Profile;
  },

  async resetOnboarding(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ onboarding_completed: false })
      .eq('id', userId);

    if (error) throw error;
    return data;
  }
};
