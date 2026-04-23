import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../lib/db';
import { makeVapiCall, formatPhoneNumber } from '../../../lib/vapi';

const COST_PER_MINUTE = 0.05; // $0.05/min with BYOC (SignalWire + Cartesia via VAPI)
const MIN_BALANCE = 1.0;

// POST /api/call — initiate a voice call to a lead via VAPI
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { leadId, bulkLeadIds } = body;

    // Support bulk calling (from CSV/sheet)
    const leadIds: string[] = bulkLeadIds || (leadId ? [leadId] : []);

    if (leadIds.length === 0) {
      return NextResponse.json({ error: 'leadId or bulkLeadIds is required' }, { status: 400 });
    }

    const results: any[] = [];

    for (const id of leadIds) {
      try {
        const lead = await prisma.lead.findUnique({
          where: { id },
          include: { user: true },
        });

        if (!lead) {
          results.push({ leadId: id, error: 'Lead not found' });
          continue;
        }

        // Skip SIP addresses
        if (lead.phone.includes('@')) {
          results.push({ leadId: id, error: 'SIP addresses not supported' });
          continue;
        }

        // Check wallet balance
        if (lead.user.walletAmount < MIN_BALANCE) {
          results.push({ leadId: id, error: `Insufficient balance: $${lead.user.walletAmount.toFixed(2)}` });
          continue;
        }

        // Create call record
        const callRecord = await prisma.call.create({
          data: { leadId: id, status: 'initiated', duration: 0, costDeducted: 0 },
        });

        // Update lead status
        await prisma.lead.update({
          where: { id },
          data: { status: 'calling' },
        });

        const formattedPhone = formatPhoneNumber(lead.phone);

        // Call via VAPI (SignalWire + Cartesia configured in VAPI dashboard)
        const vapiResult = await makeVapiCall({
          customerPhone: formattedPhone,
          customerName: lead.name,
          assistantOverrides: lead.user.script ? {
            firstMessage: `Hi ${lead.name}, ${lead.user.script.substring(0, 100)}`,
          } : undefined,
        });

        // Save VAPI call ID
        await prisma.call.update({
          where: { id: callRecord.id },
          data: { status: `vapi:${vapiResult.id}` },
        });

        results.push({ leadId: id, success: true, vapiCallId: vapiResult.id });
      } catch (innerError: any) {
        console.error(`Call error for lead ${id}:`, innerError);
        await prisma.lead.update({ where: { id }, data: { status: 'failed' } }).catch(() => {});
        results.push({ leadId: id, error: innerError.message });
      }
    }

    // Single call response vs bulk
    if (!bulkLeadIds && results.length === 1) {
      const r = results[0];
      if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ success: true, vapiCallId: r.vapiCallId });
    }

    return NextResponse.json({ results });
  } catch (error: any) {
    console.error('CRITICAL CALL API ERROR:', error);
    return NextResponse.json({ error: `System Error: ${error.message}` }, { status: 500 });
  }
}
