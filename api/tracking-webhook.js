const SibApiV3Sdk = require("sib-api-v3-sdk");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const event = req.body;

    // EasyPost sends tracker updates as events
    if (event.description !== "tracker.updated") {
      return res.status(200).json({ received: true });
    }

    const tracker = event.result;
    const status  = tracker.status; // pre_transit, in_transit, out_for_delivery, delivered, etc.

    // Only email on meaningful status changes
    const emailStatuses = ["in_transit", "out_for_delivery", "delivered"];
    if (!emailStatuses.includes(status)) return res.status(200).json({ received: true });

    // Get customer email from tracker metadata (we store it when creating label)
    const customerEmail = tracker.shipment_id
      ? await getCustomerEmailFromOrder(tracker.shipment_id)
      : null;

    if (!customerEmail) return res.status(200).json({ received: true });

    // Send email via Brevo
    const defaultClient = SibApiV3Sdk.ApiClient.instance;
    defaultClient.authentications["api-key"].apiKey = process.env.BREVO_API_KEY;

    const api = new SibApiV3Sdk.TransactionalEmailsApi();

    const templates = {
      in_transit:       { subject: "📦 Your Canela Beauty order is on its way!", emoji: "🚚" },
      out_for_delivery: { subject: "🎉 Your order is out for delivery today!", emoji: "📬" },
      delivered:        { subject: "✅ Your Canela Beauty order was delivered!", emoji: "💄" },
    };

    const tpl = templates[status];

    const trackingUrl = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracker.tracking_code}`;

    await api.sendTransacEmail({
      sender:  { name: "Canela Beauty", email: process.env.FROM_EMAIL || "hello@canelabauty.com" },
      to:      [{ email: customerEmail }],
      subject: tpl.subject,
      htmlContent: buildEmailHTML(status, tpl.emoji, tracker.tracking_code, trackingUrl),
    });

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(500).json({ error: err.message });
  }
}

function buildEmailHTML(status, emoji, trackingCode, trackingUrl) {
  const messages = {
    in_transit:       "Your order has been picked up and is on its way to you.",
    out_for_delivery: "Great news — your package is out for delivery and should arrive today.",
    delivered:        "Your order has been delivered. We hope you love it! 💕",
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#FAF6EF;font-family:'Georgia',serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border:1px solid rgba(139,90,30,0.15);border-radius:4px;overflow:hidden;">
    
    <!-- Header -->
    <div style="background:#3D1F00;padding:28px 36px;text-align:center;">
      <p style="font-size:22px;font-weight:300;letter-spacing:6px;text-transform:uppercase;color:#FAF6EF;margin:0;">
        Canela <em style="color:#C9941A;">Beauty</em>
      </p>
    </div>

    <!-- Body -->
    <div style="padding:40px 36px;text-align:center;">
      <p style="font-size:40px;margin:0 0 16px;">${emoji}</p>
      <h1 style="font-size:26px;font-weight:300;color:#3D1F00;margin:0 0 16px;letter-spacing:1px;">
        ${status === 'delivered' ? 'Delivered!' : status === 'out_for_delivery' ? 'On its way to you!' : 'Your order is moving!'}
      </h1>
      <p style="font-size:14px;color:rgba(61,31,0,0.6);line-height:1.8;margin:0 0 28px;">
        ${messages[status]}
      </p>

      <!-- Tracking number -->
      <div style="background:#FAF6EF;border:1px solid rgba(139,90,30,0.15);border-radius:3px;padding:16px;margin-bottom:28px;">
        <p style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(61,31,0,0.45);margin:0 0 6px;">Tracking Number</p>
        <p style="font-size:16px;color:#3D1F00;font-weight:500;margin:0;">${trackingCode}</p>
      </div>

      ${status !== 'delivered' ? `
      <a href="${trackingUrl}" 
         style="display:inline-block;background:#3D1F00;color:#FAF6EF;padding:13px 32px;text-decoration:none;font-size:11px;letter-spacing:3px;text-transform:uppercase;border-radius:2px;">
        Track My Order
      </a>` : `
      <p style="font-size:13px;color:rgba(61,31,0,0.5);">
        We'd love to see you wearing it! Tag us <strong>@canelabauty</strong> 💄
      </p>`}
    </div>

    <!-- Footer -->
    <div style="border-top:1px solid rgba(139,90,30,0.1);padding:20px 36px;text-align:center;">
      <p style="font-size:10px;color:rgba(61,31,0,0.35);letter-spacing:1px;margin:0;">
        © 2026 Canela Beauty · Elizabeth, NJ · <a href="#" style="color:rgba(61,31,0,0.35);">Unsubscribe</a>
      </p>
    </div>

  </div>
</body>
</html>`;
}

// Helper: get customer email stored when order was created
async function getCustomerEmailFromOrder(shipmentId) {
  try {
    const stored = JSON.parse(process.env._ORDER_MAP || "{}");
    return stored[shipmentId] || null;
  } catch { return null; }
}
