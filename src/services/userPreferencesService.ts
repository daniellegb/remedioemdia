import { supabase } from '../lib/supabase';
import { UserPreferences } from '../../types';

export const userPreferencesService = {
  async getPreferences(userId: string): Promise<UserPreferences | null> {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async updatePreferences(userId: string, preferences: Partial<UserPreferences>) {
    const payload = {
      user_id: userId,
      ...preferences,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('user_preferences')
      .upsert(payload)
      .select()
      .single();

    if (error) {
      console.error('Error updating preferences:', error);
      throw error;
    }

    return data;
  }
};
