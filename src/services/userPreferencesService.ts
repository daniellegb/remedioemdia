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
    const payload: any = {
      user_id: userId,
      ...preferences,
      updated_at: new Date().toISOString()
    };

    const attemptUpsert = async (currentPayload: any): Promise<any> => {
      const { data, error } = await supabase
        .from('user_preferences')
        .upsert(currentPayload, { onConflict: 'user_id' })
        .select()
        .single();

      if (error) {
        // Handle missing column error (PGRST204) gracefully by retrying without the offending column
        if (error.code === 'PGRST204') {
          console.warn('Database schema out of sync:', error.message);
          
          // Extract column name from error message: "Could not find the 'column_name' column..."
          const match = error.message.match(/column '([^']+)'/i) || error.message.match(/column "([^"]+)"/i);
          const columnName = match ? match[1] : null;

          if (columnName && currentPayload[columnName] !== undefined && columnName !== 'user_id') {
            console.info(`Retrying without missing column: ${columnName}`);
            const nextPayload = { ...currentPayload };
            delete nextPayload[columnName];
            return attemptUpsert(nextPayload);
          }
          
          return null;
        }
        throw error;
      }
      return data;
    };

    try {
      return await attemptUpsert(payload);
    } catch (error) {
      console.error('Error updating preferences:', error);
      throw error;
    }
  }
};
