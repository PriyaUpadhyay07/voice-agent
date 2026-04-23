import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../lib/db';
import crypto from 'crypto';

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// POST /api/razorpay/webhook — auto-add credits on successful payment
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // Verify webhook signature
    if (RAZORPAY_WEBHOOK_SECRET) {
      const signature = request.headers.get('x-razorpay-signature');
      if (signature) {
        const expectedSignature = crypto
          .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
          .update(rawBody)
          .digest('hex');

        if (signature !== expectedSignature) {
          console.error('[Razorpay Webhook] Invalid signature');
          return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
        }
      }
    }

    const body = JSON.parse(rawBody);
    const event = body.event;

    console.log(`[Razorpay Webhook] Event: ${event}`);

    if (event === 'payment.captured') {
      const payment = body.payload?.payment?.entity;

      if (!payment) {
        return NextResponse.json({ ok: true });
      }

      const userId = payment.notes?.userId;
      const credits = parseFloat(payment.notes?.credits) || 0;
      const amountPaid = payment.amount / 100; // Convert paise to INR

      if (!userId || credits <= 0) {
        console.log('[Razorpay Webhook] Missing userId or credits in notes');
        return NextResponse.json({ ok: true });
      }

      // Add credits to user wallet
      await prisma.user.update({
        where: { id: userId },
        data: {
          walletAmount: { increment: credits },
        },
      });

      console.log(`[Razorpay Webhook] Added $${credits} credits to user ${userId} (paid ₹${amountPaid})`);
    }

    if (event === 'payment.failed') {
      const payment = body.payload?.payment?.entity;
      console.log(`[Razorpay Webhook] Payment failed for order: ${payment?.order_id}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[Razorpay Webhook] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
