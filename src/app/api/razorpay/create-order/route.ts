import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../lib/db';
import crypto from 'crypto';

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

// Credit packages (amount in INR paise)
const CREDIT_PACKAGES: Record<number, number> = {
  500: 5,      // ₹500 = $5 credits
  1000: 10,    // ₹1000 = $10 credits
  2500: 25,    // ₹2500 = $25 credits
  5000: 50,    // ₹5000 = $50 credits
};

// POST /api/razorpay/create-order — create a Razorpay order
export async function POST(request: NextRequest) {
  try {
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      return NextResponse.json({ error: 'Razorpay not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { amount, userId } = body; // amount in INR (e.g., 500, 1000)

    if (!amount || !userId) {
      return NextResponse.json({ error: 'amount and userId are required' }, { status: 400 });
    }

    // Create order via Razorpay API
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');

    const orderRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amount * 100, // Razorpay expects paise
        currency: 'INR',
        receipt: `credit_${userId}_${Date.now()}`,
        notes: {
          userId,
          credits: CREDIT_PACKAGES[amount] || Math.floor(amount / 100),
        },
      }),
    });

    if (!orderRes.ok) {
      const errText = await orderRes.text();
      throw new Error(`Razorpay order failed: ${errText}`);
    }

    const order = await orderRes.json();

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: RAZORPAY_KEY_ID,
      credits: CREDIT_PACKAGES[amount] || Math.floor(amount / 100),
    });
  } catch (error: any) {
    console.error('[Razorpay Create Order] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
