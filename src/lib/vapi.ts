// VAPI API Integration - Uses BYOC (SignalWire + Cartesia configured in VAPI Dashboard)

const VAPI_API_URL = 'https://api.vapi.ai';
const VAPI_PRIVATE_KEY = process.env.VAPI_PRIVATE_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;

interface VapiCallOptions {
  customerPhone: string;
  customerName?: string;
  assistantOverrides?: Record<string, any>;
}

// Make an outbound call via VAPI
export async function makeVapiCall(options: VapiCallOptions) {
  if (!VAPI_PRIVATE_KEY || !VAPI_ASSISTANT_ID || !VAPI_PHONE_NUMBER_ID) {
    throw new Error('VAPI credentials not set. Check VAPI_PRIVATE_KEY, VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID in .env');
  }

  const payload: any = {
    assistantId: VAPI_ASSISTANT_ID,
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    customer: {
      number: options.customerPhone,
      name: options.customerName || 'Customer',
    },
  };

  // Allow overriding assistant settings (e.g., custom script per call)
  if (options.assistantOverrides) {
    payload.assistantOverrides = options.assistantOverrides;
  }

  const response = await fetch(`${VAPI_API_URL}/call/phone`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${VAPI_PRIVATE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`VAPI Call Failed (${response.status}): ${errorText}`);
  }

  return await response.json();
}

// Smart phone number formatter
export function formatPhoneNumber(raw: string): string {
  if (raw.toLowerCase().startsWith('sip:') || raw.includes('@')) {
    return raw;
  }
  const cleaned = raw.replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (/^[6-9]\d{9}$/.test(cleaned)) return `+91${cleaned}`;
  if (/^\d{10}$/.test(cleaned)) return `+1${cleaned}`;
  if (/^91[6-9]\d{9}$/.test(cleaned)) return `+${cleaned}`;
  if (/^1\d{10}$/.test(cleaned)) return `+${cleaned}`;
  return `+${cleaned}`;
}
