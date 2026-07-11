// netlify/functions/verify-payment.js
//
// Ce face: primește un payment_intent de la site (testcuplu.ro) și întreabă
// DIRECT serverele Stripe dacă acea plată chiar a avut loc și a reușit.
// Cheia secretă Stripe (STRIPE_SECRET_KEY) NU e niciodată vizibilă în browser —
// stă doar aici, pe server, citită dintr-o variabilă de mediu Netlify.
//
// Suma și moneda așteptate (29 RON = 2900 bani) sunt verificate explicit,
// ca să nu poată fi refolosit un payment_intent de la altă tranzacție/alt preț.

const EXPECTED_AMOUNT = 2900; // 29.00 RON, în bani (subunitatea Stripe)
const EXPECTED_CURRENCY = 'ron';

exports.handler = async function (event) {
  // Doar POST e acceptat
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ valid: false, error: 'Method not allowed' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ valid: false, error: 'Invalid request body' })
    };
  }

  const paymentIntentId = body.payment_intent;

  // Validare de bază a formatului — Stripe generează mereu id-uri care încep cu "pi_"
  if (!paymentIntentId || typeof paymentIntentId !== 'string' || paymentIntentId.indexOf('pi_') !== 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ valid: false, error: 'Missing or invalid payment_intent' })
    };
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) {
    console.error('[verify-payment] STRIPE_SECRET_KEY lipsește din variabilele de mediu Netlify');
    return {
      statusCode: 500,
      body: JSON.stringify({ valid: false, error: 'Server misconfigured' })
    };
  }

  try {
    const stripeResp = await fetch(
      'https://api.stripe.com/v1/payment_intents/' + encodeURIComponent(paymentIntentId),
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + STRIPE_SECRET_KEY
        }
      }
    );

    if (!stripeResp.ok) {
      // Stripe nu a găsit acest payment_intent, sau cheia e greșită
      return {
        statusCode: 200,
        body: JSON.stringify({ valid: false, error: 'Payment intent not found' })
      };
    }

    const intent = await stripeResp.json();

    const isSucceeded = intent.status === 'succeeded';
    const isCorrectAmount = intent.amount === EXPECTED_AMOUNT;
    const isCorrectCurrency = (intent.currency || '').toLowerCase() === EXPECTED_CURRENCY;

    if (isSucceeded && isCorrectAmount && isCorrectCurrency) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          valid: true,
          email: intent.receipt_email || null
        })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        valid: false,
        error: 'Payment not valid (status: ' + intent.status + ')'
      })
    };
  } catch (err) {
    console.error('[verify-payment] Eroare la verificarea cu Stripe:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ valid: false, error: 'Verification failed' })
    };
  }
};
