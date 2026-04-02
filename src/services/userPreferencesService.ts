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
    try {
      const { data, error } = await supabase
        .from('user_preferences')
        .upsert({
          user_id: userId,
          ...preferences,
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        // Handle missing column error gracefully
        if (error.code === 'PGRST204') {
          console.warn('Database schema out of sync. Some settings might not be saved to the cloud yet. Please run the updated SQL script in Supabase.', error.message);
          return null;
        }
        throw error;
      }
      return data;
    } catch (error) {
      console.error('Error updating preferences:', error);
      throw error;
    }
  }
};
