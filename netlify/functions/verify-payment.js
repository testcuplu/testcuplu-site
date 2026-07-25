// netlify/functions/verify-payment.js
//
// Ce face: primește un id de la site (testcuplu.ro) — fie un payment_intent (pi_...),
// fie un checkout session id (cs_...) — și întreabă DIRECT serverele Stripe dacă acea
// plată chiar a avut loc și a reușit.
// Cheia secretă Stripe (STRIPE_SECRET_KEY) NU e niciodată vizibilă în browser —
// stă doar aici, pe server, citită dintr-o variabilă de mediu Netlify.
//
// Suma și moneda așteptate (29 RON = 2900 bani) sunt verificate explicit,
// ca să nu poată fi refolosit un id de la altă tranzacție/alt preț.
//
// IMPORTANT — cupoane de reducere (inclusiv 100%):
// Pentru checkout sessions, verificăm `amount_subtotal` (prețul REAL al produsului,
// înainte de orice cupon), nu `amount_total` (suma finală, după reducere).
// Asta înseamnă: dacă produsul din catalogul Stripe costă cu adevărat 29 RON,
// verificarea trece — indiferent dacă a fost plătit integral sau cu cupon de
// reducere (0%, 50%, 100%). Cineva NU poate falsifica asta din browser, pentru
// că amount_subtotal vine din obiectul Price definit de tine în Stripe, nu din
// ce trimite clientul. Rămâne o protecție anti-fraudă reală, doar mutată pe
// prețul de listă, nu pe suma finală încasată.

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

  const rawId = body.payment_intent || body.session_id;

  if (!rawId || typeof rawId !== 'string') {
    return {
      statusCode: 400,
      body: JSON.stringify({ valid: false, error: 'Missing payment identifier' })
    };
  }

  const isPaymentIntent = rawId.indexOf('pi_') === 0;
  const isCheckoutSession = rawId.indexOf('cs_') === 0;

  if (!isPaymentIntent && !isCheckoutSession) {
    return {
      statusCode: 400,
      body: JSON.stringify({ valid: false, error: 'Invalid identifier format' })
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
    let intent;

    if (isCheckoutSession) {
      // Cerem sesiunea de checkout, cu payment_intent expandat, ca să avem toate detaliile
      const stripeResp = await fetch(
        'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(rawId) + '?expand[]=payment_intent',
        { headers: { Authorization: 'Bearer ' + STRIPE_SECRET_KEY } }
      );

      if (!stripeResp.ok) {
        return {
          statusCode: 200,
          body: JSON.stringify({ valid: false, error: 'Checkout session not found' })
        };
      }

      const session = await stripeResp.json();

      const isPaid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
      // amount_subtotal = prețul real al produsului, ÎNAINTE de orice cupon/reducere.
      // Rămâne 2900 chiar și cu un cupon de 100% off (când amount_total devine 0).
      const isCorrectAmount = session.amount_subtotal === EXPECTED_AMOUNT;
      const isCorrectCurrency = (session.currency || '').toLowerCase() === EXPECTED_CURRENCY;

      if (isPaid && isCorrectAmount && isCorrectCurrency) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            valid: true,
            email: session.customer_details ? session.customer_details.email : null
          })
        };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ valid: false, error: 'Payment not valid (status: ' + session.payment_status + ')' })
      };
    }

    // isPaymentIntent
    const stripeResp = await fetch(
      'https://api.stripe.com/v1/payment_intents/' + encodeURIComponent(rawId),
      { headers: { Authorization: 'Bearer ' + STRIPE_SECRET_KEY } }
    );

    if (!stripeResp.ok) {
      return {
        statusCode: 200,
        body: JSON.stringify({ valid: false, error: 'Payment intent not found' })
      };
    }

    intent = await stripeResp.json();

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
