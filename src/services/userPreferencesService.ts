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

  async updatePreferences(userId: string, preferences: Partial<UserPreferences>): Promise<UserPreferences> {
    const cleanedPreferences = Object.fromEntries(
      Object.entries(preferences).filter(([_, value]) => value !== undefined)
    );

    const payload = {
      user_id: userId,
      ...cleanedPreferences,
      // We don't force updated_at here, let the DB trigger handle it
      // unless the user specifically wants to pass a specific timestamp
    };

    const { data, error } = await supabase
      .from('user_preferences')
      .upsert(payload)
      .select()
      .single<UserPreferences>();

    if (error) {
      console.error('Error updating preferences:', error);
      throw error;
    }

    return data;
  }
};
