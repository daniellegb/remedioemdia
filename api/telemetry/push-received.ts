import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

function getEarliestIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  try {
    return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
  } catch {
    return a || b;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { 
    notification_id, 
    event_type, 
    timestamp, 
    sw_received_at,
    show_notification_started_at,
    completed_at,
    failed_at,
    tag, 
    title, 
    user_agent,
    device_type,
    endpoint,
    error 
  } = req.body || {};

  if (!notification_id) {
    return res.status(400).json({ error: 'notification_id is required' });
  }

  const eventTime = timestamp || new Date().toISOString();

  try {
    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('notification_queue')
      .select('id, metadata')
      .eq('id', notification_id)
      .single();

    if (fetchErr) {
      console.warn(`[Telemetry Serverless] Could not fetch notification_queue record ${notification_id}:`, fetchErr.message);
    }

    if (current) {
      const existingMeta = current.metadata || {};
      const telemetryEvents: any[] = existingMeta.telemetry_events || [];
      const devicesMap: Record<string, any> = existingMeta.devices || {};

      let deviceKey = 'unknown_device';
      if (endpoint && typeof endpoint === 'string') {
        const epSnippet = endpoint.length > 32 ? endpoint.slice(-32) : endpoint;
        deviceKey = `ep_${epSnippet.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      } else if (device_type) {
        deviceKey = `dev_${device_type}_${(user_agent || 'unknown').slice(0, 20).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      }

      const existingDevice = devicesMap[deviceKey] || {
        device_type: device_type || (user_agent?.includes('Android') ? 'android' : (user_agent?.includes('iPhone') ? 'ios' : 'desktop')),
        user_agent: user_agent || 'unknown',
        endpoint_snippet: endpoint && typeof endpoint === 'string' ? (endpoint.length > 50 ? endpoint.slice(0, 30) + '...' + endpoint.slice(-20) : endpoint) : undefined
      };

      if (device_type && !existingDevice.device_type) {
        existingDevice.device_type = device_type;
      }
      if (user_agent && existingDevice.user_agent === 'unknown') {
        existingDevice.user_agent = user_agent;
      }

      if (event_type === 'service_worker_push_received') {
        const receivedTime = sw_received_at || eventTime;
        existingDevice.sw_received_at = getEarliestIso(existingDevice.sw_received_at, receivedTime);
      } else if (event_type === 'show_notification_started') {
        const startTime = show_notification_started_at || eventTime;
        existingDevice.show_notification_started_at = getEarliestIso(existingDevice.show_notification_started_at, startTime);
        if (!existingDevice.sw_received_at) {
          existingDevice.sw_received_at = existingDevice.show_notification_started_at;
        }
      } else if (event_type === 'show_notification_completed') {
        const compTime = completed_at || eventTime;
        existingDevice.show_notification_completed_at = getEarliestIso(existingDevice.show_notification_completed_at, compTime);
      } else if (event_type === 'show_notification_failed') {
        const failTime = failed_at || eventTime;
        existingDevice.show_notification_failed_at = getEarliestIso(existingDevice.show_notification_failed_at, failTime);
        existingDevice.show_notification_error = error;
      }

      existingDevice.last_event_at = eventTime;
      devicesMap[deviceKey] = existingDevice;

      const isDuplicateEvent = telemetryEvents.some(
        e => e.device_key === deviceKey && e.event_type === event_type && e.timestamp === eventTime
      );

      if (!isDuplicateEvent) {
        telemetryEvents.push({
          event_type,
          timestamp: eventTime,
          tag,
          title,
          user_agent,
          device_type,
          device_key: deviceKey,
          endpoint_snippet: existingDevice.endpoint_snippet,
          error
        });
      }

      const updatedMeta: any = {
        ...existingMeta,
        devices: devicesMap,
        telemetry_events: telemetryEvents,
        last_sw_device: deviceKey,
        last_sw_event_at: eventTime
      };

      if (event_type === 'service_worker_push_received') {
        updatedMeta.sw_received_at = getEarliestIso(existingMeta.sw_received_at, sw_received_at || eventTime);
      } else if (event_type === 'show_notification_started') {
        updatedMeta.show_notification_started_at = getEarliestIso(existingMeta.show_notification_started_at, show_notification_started_at || eventTime);
        if (!updatedMeta.sw_received_at) {
          updatedMeta.sw_received_at = updatedMeta.show_notification_started_at;
        }
      } else if (event_type === 'show_notification_completed') {
        updatedMeta.show_notification_completed_at = getEarliestIso(existingMeta.show_notification_completed_at, completed_at || eventTime);
      } else if (event_type === 'show_notification_failed') {
        updatedMeta.show_notification_failed_at = getEarliestIso(existingMeta.show_notification_failed_at, failed_at || eventTime);
        updatedMeta.show_notification_error = error;
      }

      await supabaseAdmin
        .from('notification_queue')
        .update({ metadata: updatedMeta })
        .eq('id', notification_id);
    }

    return res.status(200).json({ success: true, notification_id, event_type, device_key: req.body.endpoint ? 'endpoint_associated' : 'anonymous' });
  } catch (err: any) {
    console.error('[Telemetry Serverless] Erro ao gravar telemetria:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
