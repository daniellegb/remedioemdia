import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS if needed
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: queueItems, error } = await supabaseAdmin
      .from('notification_queue')
      .select('id, user_id, title, scheduled_at, sent_at, created_at, metadata')
      .not('metadata', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const report = (queueItems || []).map(item => {
      const meta = item.metadata || {};
      const scheduled = item.scheduled_at || item.created_at;
      const scheduledMs = scheduled ? new Date(scheduled).getTime() : null;
      const deliveryAttempts: any[] = meta.delivery_attempts || [];
      const devicesMap: Record<string, any> = meta.devices || {};

      const devicesReport: any[] = [];
      const seenDeviceKeys = new Set<string>();

      if (deliveryAttempts.length > 0) {
        deliveryAttempts.forEach(attempt => {
          const ep = attempt.endpoint || '';
          let epKey = 'unknown_device';
          if (ep && typeof ep === 'string') {
            const epSnippet = ep.length > 32 ? ep.slice(-32) : ep;
            epKey = `ep_${epSnippet.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
          }

          let telemetryMatch = devicesMap[epKey];
          if (!telemetryMatch) {
            const matchingKey = Object.keys(devicesMap).find(k => {
              const d = devicesMap[k];
              return d.endpoint_snippet && ep && (ep.includes(d.endpoint_snippet) || d.endpoint_snippet.includes(ep.slice(-20)));
            });
            if (matchingKey) {
              telemetryMatch = devicesMap[matchingKey];
              epKey = matchingKey;
            }
          }

          if (epKey) {
            seenDeviceKeys.add(epKey);
          }

          const devType = telemetryMatch?.device_type || attempt.device_type || (attempt.user_agent?.includes('Android') ? 'android' : (attempt.user_agent?.includes('iPhone') ? 'ios' : 'desktop'));
          const swReceived = telemetryMatch?.sw_received_at || null;
          const showStarted = telemetryMatch?.show_notification_started_at || null;
          const showCompleted = telemetryMatch?.show_notification_completed_at || null;
          const showFailed = telemetryMatch?.show_notification_failed_at || null;
          const showErr = telemetryMatch?.show_notification_error || null;
          const acceptedTime = attempt.accepted_at || attempt.attempted_at || item.sent_at || meta.push_service_accepted_at || null;

          let devDelayMs: number | null = null;
          let devDelayStr = 'N/A';
          if (swReceived && scheduledMs) {
            devDelayMs = new Date(swReceived).getTime() - scheduledMs;
            const diffSec = Math.round(devDelayMs / 1000);
            devDelayStr = diffSec >= 60 ? `${(diffSec / 60).toFixed(2)} min` : `${diffSec}s`;
          }

          let devState: string;
          let diagnosticNote: string;

          if (!attempt.success) {
            devState = 'PUSH_SERVICE_FAILED';
            diagnosticNote = `Push service rejected token: ${attempt.error || attempt.statusCode || 'Unknown error'}`;
          } else if (showFailed) {
            devState = 'SHOW_NOTIFICATION_FAILED';
            diagnosticNote = `SW received push, but showNotification failed: ${showErr}`;
          } else if (swReceived) {
            if (Math.abs(devDelayMs || 0) > 120000) {
              devState = 'DELIVERED_WITH_DELAY';
              diagnosticNote = devType === 'android'
                ? `Delivered with delay of ${devDelayStr}. Confirmed by Service Worker (typical of Android Doze Mode / Locked Screen).`
                : `Delivered with delay of ${devDelayStr}. Confirmed by Service Worker.`;
            } else {
              devState = 'DELIVERED_PROMPTLY';
              diagnosticNote = 'Delivered promptly on scheduled time.';
            }
          } else {
            devState = 'AWAITING_RECEIPT_CONFIRMATION';
            diagnosticNote = devType === 'android'
              ? 'Accepted by push service (FCM). Awaiting Service Worker receipt confirmation (device may be locked, in Doze Mode, or offline).'
              : 'Accepted by push service. Awaiting Service Worker receipt confirmation.';
          }

          devicesReport.push({
            device_type: devType,
            user_agent: attempt.user_agent || telemetryMatch?.user_agent || 'unknown',
            endpoint_masked: attempt.endpoint_masked || (ep ? ep.substring(0, 35) + '...' : 'unknown'),
            push_service_accepted_at: acceptedTime,
            sw_received_at: swReceived,
            show_notification_started_at: showStarted,
            show_notification_completed_at: showCompleted,
            show_notification_failed_at: showFailed,
            show_notification_error: showErr,
            delay_from_schedule: devDelayStr,
            delay_ms: devDelayMs,
            device_state: devState,
            diagnostic_note: diagnosticNote
          });
        });
      }

      Object.keys(devicesMap).forEach(key => {
        if (!seenDeviceKeys.has(key)) {
          const dev = devicesMap[key];
          let devDelayMs: number | null = null;
          let devDelayStr = 'N/A';
          if (dev.sw_received_at && scheduledMs) {
            devDelayMs = new Date(dev.sw_received_at).getTime() - scheduledMs;
            const diffSec = Math.round(devDelayMs / 1000);
            devDelayStr = diffSec >= 60 ? `${(diffSec / 60).toFixed(2)} min` : `${diffSec}s`;
          }

          const devState = dev.show_notification_failed_at
            ? 'SHOW_NOTIFICATION_FAILED'
            : (Math.abs(devDelayMs || 0) > 120000 ? 'DELIVERED_WITH_DELAY' : 'DELIVERED_PROMPTLY');

          devicesReport.push({
            device_type: dev.device_type || 'unknown',
            user_agent: dev.user_agent || 'unknown',
            endpoint_masked: dev.endpoint_snippet || 'unknown',
            push_service_accepted_at: item.sent_at || meta.push_service_accepted_at || null,
            sw_received_at: dev.sw_received_at || null,
            show_notification_started_at: dev.show_notification_started_at || null,
            show_notification_completed_at: dev.show_notification_completed_at || null,
            show_notification_failed_at: dev.show_notification_failed_at || null,
            show_notification_error: dev.show_notification_error || null,
            delay_from_schedule: devDelayStr,
            delay_ms: devDelayMs,
            device_state: devState,
            diagnostic_note: 'Telemetry reported directly by Service Worker.'
          });
        }
      });

      let overallDeliveryState = 'UNKNOWN';
      let diagnosisSummary = 'No telemetry received yet.';
      const acceptedAt = meta.push_service_accepted_at || item.sent_at || null;

      const totalTargeted = devicesReport.length;
      const promptlyDelivered = devicesReport.filter(d => d.device_state === 'DELIVERED_PROMPTLY').length;
      const delayedDelivered = devicesReport.filter(d => d.device_state === 'DELIVERED_WITH_DELAY').length;
      const awaitingConfirmation = devicesReport.filter(d => d.device_state === 'AWAITING_RECEIPT_CONFIRMATION').length;
      const showFailedCount = devicesReport.filter(d => d.device_state === 'SHOW_NOTIFICATION_FAILED').length;
      const pushFailedCount = devicesReport.filter(d => d.device_state === 'PUSH_SERVICE_FAILED').length;

      const pcDevice = devicesReport.find(d => d.device_type === 'desktop');
      const mobileDevice = devicesReport.find(d => d.device_type === 'android' || d.device_type === 'ios');

      if (meta.status === 'discarded') {
        overallDeliveryState = 'DISCARDED';
        diagnosisSummary = 'Notification was discarded (user disabled notifications or no active subscription).';
      } else if (meta.status === 'failed' || (pushFailedCount === totalTargeted && totalTargeted > 0)) {
        overallDeliveryState = 'PUSH_SERVICE_FAILED';
        diagnosisSummary = 'Failed to dispatch Web Push to push service.';
      } else if (showFailedCount > 0) {
        overallDeliveryState = 'SHOW_NOTIFICATION_FAILED';
        diagnosisSummary = `${showFailedCount} device(s) failed inside showNotification: ${devicesReport.find(d => d.show_notification_error)?.show_notification_error}`;
      } else if (totalTargeted > 0) {
        if (promptlyDelivered === totalTargeted) {
          overallDeliveryState = 'ALL_DEVICES_DELIVERED_PROMPTLY';
          diagnosisSummary = `All ${totalTargeted} device(s) received and displayed the notification promptly.`;
        } else if (pcDevice?.device_state === 'DELIVERED_PROMPTLY' && mobileDevice?.device_state === 'DELIVERED_WITH_DELAY') {
          overallDeliveryState = 'PC_PROMPT_ANDROID_DELAYED';
          diagnosisSummary = `PC delivered promptly, but Android was delayed by ${mobileDevice.delay_from_schedule} (Service Worker confirmed receipt after delay).`;
        } else if (pcDevice?.device_state === 'DELIVERED_PROMPTLY' && mobileDevice?.device_state === 'AWAITING_RECEIPT_CONFIRMATION') {
          overallDeliveryState = 'PC_PROMPT_ANDROID_AWAITING_RECEIPT';
          diagnosisSummary = `PC delivered promptly. Android has not reported receipt confirmation yet (device may be locked, in Doze Mode, or offline).`;
        } else if (delayedDelivered === totalTargeted) {
          overallDeliveryState = 'DELIVERED_WITH_DELAY';
          diagnosisSummary = `All ${totalTargeted} device(s) experienced delivery delay.`;
        } else if (awaitingConfirmation === totalTargeted) {
          overallDeliveryState = 'ACCEPTED_BY_PUSH_SERVICE_AWAITING_DEVICES';
          diagnosisSummary = `Push accepted by push service. All ${totalTargeted} device(s) are awaiting receipt confirmation.`;
        } else {
          overallDeliveryState = 'PARTIAL_DELIVERY';
          diagnosisSummary = `${promptlyDelivered}/${totalTargeted} devices delivered promptly (${awaitingConfirmation} awaiting confirmation, ${delayedDelivered} delayed).`;
        }
      }

      return {
        notification_id: item.id,
        title: item.title,
        scheduled_at: scheduled,
        backend_processed_at: meta.backend_processed_at,
        push_service_accepted_at: acceptedAt,
        overall_delivery_state: overallDeliveryState,
        diagnosis_summary: diagnosisSummary,
        targeted_devices_count: totalTargeted,
        delivered_promptly_count: promptlyDelivered,
        delayed_delivered_count: delayedDelivered,
        awaiting_confirmation_count: awaitingConfirmation,
        devices: devicesReport,
        legacy: {
          sw_received_at: meta.sw_received_at || null,
          show_notification_started_at: meta.show_notification_started_at || null,
          show_notification_completed_at: meta.show_notification_completed_at || null,
          show_notification_failed_at: meta.show_notification_failed_at || null,
          show_notification_error: meta.show_notification_error || null,
          delivery_state: overallDeliveryState
        },
        events: meta.telemetry_events || []
      };
    });

    return res.status(200).json({
      total: report.length,
      timestamp: new Date().toISOString(),
      report
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
