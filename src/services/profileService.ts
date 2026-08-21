import { supabase } from '../lib/supabase';
import { validateStringLength } from '../domain/validation';

export interface Profile {
  id: string;
  name?: string | null;
  full_name?: string | null;
  caregiver_name?: string | null;
  patient_name?: string | null;
  avatar_url?: string | null;
  onboarding_completed?: boolean;
  updated_at?: string;
}

export const profileService = {
  async getProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return data as Profile;
  },

  async updateProfile(userId: string, data: Partial<Profile>) {
    const updateData: any = { ...data };
    if (data.name !== undefined) updateData.name = validateStringLength(data.name, 'Nome', 100, false);
    if (data.full_name !== undefined) updateData.full_name = validateStringLength(data.full_name, 'Nome completo', 100, false);
    if (data.caregiver_name !== undefined) updateData.caregiver_name = validateStringLength(data.caregiver_name, 'Nome do cuidador', 100, false);
    if (data.patient_name !== undefined) updateData.patient_name = validateStringLength(data.patient_name, 'Nome do paciente', 100, false);

    const { data: updated, error } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return updated as Profile;
  }
};
