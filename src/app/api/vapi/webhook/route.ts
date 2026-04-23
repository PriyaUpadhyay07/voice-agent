import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../lib/db';

const COST_PER_MINUTE = 0.05; // $0.05/min BYOC rate

// POST /api/vapi/webhook — receives call events from VAPI
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message } = body;

    if (!message) {
      return NextResponse.json({ ok: true });
    }

    const eventType = message.type;
    console.log(`[VAPI Webhook] Event: ${eventType}`);

    // Handle call ended event
    if (eventType === 'end-of-call-report') {
      const vapiCallId = message.call?.id;
      const transcript = message.transcript || message.artifact?.transcript || '';
      const durationSeconds = message.durationSeconds || message.call?.duration || 0;
      const endedReason = message.endedReason || 'unknown';
      const summary = message.analysis?.summary || '';

      if (!vapiCallId) {
        console.log('[VAPI Webhook] No call ID in event, skipping');
        return NextResponse.json({ ok: true });
      }

      // Find the call record by VAPI call ID
      const callRecord = await prisma.call.findFirst({
        where: { status: { contains: vapiCallId } },
        include: { lead: { include: { user: true } } },
      });

      if (!callRecord) {
        console.log(`[VAPI Webhook] No call record found for VAPI ID: ${vapiCallId}`);
        return NextResponse.json({ ok: true });
      }

      // Calculate cost (minutes * rate)
      const durationMinutes = Math.ceil(durationSeconds / 60);
      const cost = durationMinutes * COST_PER_MINUTE;

      // Update call record with transcript, duration, cost
      await prisma.call.update({
        where: { id: callRecord.id },
        data: {
          status: 'completed',
          duration: durationSeconds,
          costDeducted: cost,
          transcript: transcript || summary || `Call ended: ${endedReason}`,
        },
      });

      // Deduct credits from user wallet
      await prisma.user.update({
        where: { id: callRecord.lead.userId },
        data: {
          walletAmount: { decrement: cost },
        },
      });

      // Auto-detect lead status from AI analysis
      let leadStatus = 'completed';
      const analysisLower = (summary + ' ' + transcript).toLowerCase();
      if (analysisLower.includes('interested') || analysisLower.includes('schedule') || analysisLower.includes('demo')) {
        leadStatus = 'interested';
      } else if (analysisLower.includes('busy') || analysisLower.includes('call back') || analysisLower.includes('not available')) {
        leadStatus = 'busy';
      } else if (analysisLower.includes('not interested') || analysisLower.includes('no thank') || analysisLower.includes('remove')) {
        leadStatus = 'rejected';
      }

      await prisma.lead.update({
        where: { id: callRecord.leadId },
        data: { status: leadStatus },
      });

      console.log(`[VAPI Webhook] Call ${vapiCallId} → ${leadStatus}, ${durationSeconds}s, $${cost.toFixed(2)}`);
    }

    // Handle status update (call started, ringing, etc.)
    if (eventType === 'status-update') {
      const vapiCallId = message.call?.id;
      const status = message.status;

      if (vapiCallId && status) {
        const callRecord = await prisma.call.findFirst({
          where: { status: { contains: vapiCallId } },
        });

        if (callRecord) {
          await prisma.call.update({
            where: { id: callRecord.id },
            data: { status: `vapi:${vapiCallId}:${status}` },
          });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[VAPI Webhook] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
