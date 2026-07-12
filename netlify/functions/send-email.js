// netlify/functions/send-email.js
//
// Funcție server-side pentru trimiterea de emailuri prin Brevo.
// Cheia API Brevo NU mai există în codul client (HTML) — stă doar aici,
// ca variabilă de mediu Netlify, invizibilă oricui deschide sursa paginii.
//
// Configurare necesară în Netlify (Project configuration → Environment variables):
//   BREVO_API_KEY = xkeysib-... (cheia reală, mutată din HTML)
//
// Acceptă două tipuri de cereri de la site (câmpul "type" din body):
//   1. type: "report"   — email cu raportul complet, htmlContent gata construit de client
//   2. type: "recovery" — email de recovery, trimis printr-un șablon Brevo (templateId + params)
//
// De ce ambele tipuri într-o singură funcție: raportul mare are conținut generat
// dinamic în JS (nu poate fi un șablon fix Brevo), recovery-ul folosește șabloane
// Brevo existente (BREVO_TEMPLATE_RECOVERY_RO/EN). Separarea payload-ului pe "type"
// evită duplicarea configurării senderului și a gestionării erorilor.

const BREVO_SENDER_EMAIL = 'contact@testcuplu.ro';
const BREVO_SENDER_NAME = 'testcuplu.ro';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error('[send-email] BREVO_API_KEY lipsește din variabilele de mediu Netlify');
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Server misconfigured (missing API key)' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: 'Invalid JSON body' }),
    };
  }

  const { type, to } = payload;

  if (!to || typeof to !== 'string' || to.indexOf('@') === -1) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: 'Missing or invalid "to" email' }),
    };
  }

  let brevoBody;

  if (type === 'report') {
    const { subject, htmlContent } = payload;
    if (!subject || !htmlContent) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Missing subject or htmlContent for report email' }),
      };
    }
    brevoBody = {
      sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
      to: [{ email: to }],
      subject: subject,
      htmlContent: htmlContent,
    };
  } else if (type === 'recovery') {
    const { templateId, params } = payload;
    if (!templateId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Missing templateId for recovery email' }),
      };
    }
    brevoBody = {
      templateId: templateId,
      to: [{ email: to }],
      params: params || {},
    };
  } else {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: 'Missing or invalid "type" (expected "report" or "recovery")' }),
    };
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(brevoBody),
    });

    const text = await response.text();

    if (!response.ok) {
      console.error('[send-email] Brevo a răspuns cu eroare:', response.status, text);
      return {
        statusCode: 502,
        body: JSON.stringify({ success: false, error: 'Brevo ' + response.status + ': ' + text }),
      };
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = {};
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, messageId: data.messageId || null }),
    };
  } catch (err) {
    console.error('[send-email] Eroare la apelul către Brevo:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: String(err) }),
    };
  }
};
