module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const brevoKey  = process.env.BREVO_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || "jcnay157@gmail.com";
  const fromName  = process.env.FROM_NAME  || "Jonara Beauty";

  try {
    const event = req.body;

    // Only handle successful payments
    if (event.type !== "checkout.session.completed") {
      return res.status(200).json({ received: true });
    }

    const session = event.data?.object;
    if (!session || session.payment_status !== "paid") {
      return res.status(200).json({ received: true });
    }

    const customerEmail = session.customer_details?.email;
    const customerName  = session.shipping_details?.name || session.customer_details?.name || "Customer";
    const total         = (session.amount_total / 100).toFixed(2);
    const orderId       = session.id.slice(-8).toUpperCase();

    if (!customerEmail || !brevoKey) return res.status(200).json({ received: true });

    // Send order confirmation via Brevo
    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": brevoKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email: customerEmail, name: customerName }],
        subject: `Order Confirmed ✦ Jonara Beauty #${orderId}`,
        htmlContent: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#FDF9F7;font-family:Georgia,serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border:1px solid rgba(92,26,36,0.12);border-radius:4px;overflow:hidden;">

    <div style="background:#5C1A24;padding:28px 36px;text-align:center;">
      <p style="font-family:Georgia,serif;font-size:24px;font-weight:300;letter-spacing:6px;text-transform:uppercase;color:#FDF9F7;margin:0;">JONARA <em style="color:#B8943C">Beauty</em></p>
    </div>

    <div style="padding:40px 36px;text-align:center;">
      <p style="font-size:32px;margin:0 0 16px">✦</p>
      <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:300;color:#5C1A24;margin:0 0 8px;">Your order is confirmed!</h1>
      <p style="font-size:14px;color:rgba(92,26,36,0.55);margin:0 0 28px;">Thank you, ${customerName}. We're preparing your order with love.</p>

      <div style="background:#FDF9F7;border:1px solid rgba(92,26,36,0.1);border-radius:3px;padding:20px;margin-bottom:24px;text-align:left;">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(92,26,36,0.45);">Order</span>
          <span style="font-size:13px;color:#5C1A24;font-weight:500;">#${orderId}</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(92,26,36,0.45);">Total</span>
          <span style="font-size:18px;font-family:Georgia,serif;color:#B8943C;font-weight:300;">$${total} USD</span>
        </div>
      </div>

      <p style="font-size:13px;color:rgba(92,26,36,0.55);line-height:1.8;margin:0 0 28px;">You'll receive another email with your tracking number once your order ships — usually within 1–2 business days.</p>

      <a href="https://jonarabeauty.vercel.app/account" style="display:inline-block;background:#5C1A24;color:#FDF9F7;padding:13px 32px;text-decoration:none;font-size:11px;letter-spacing:3px;text-transform:uppercase;border-radius:2px;">View My Account</a>
    </div>

    <div style="background:#F8F1ED;padding:18px 36px;text-align:center;border-top:1px solid rgba(92,26,36,0.08);">
      <p style="font-size:11px;color:rgba(92,26,36,0.4);margin:0;">Questions? <a href="mailto:jcnay157@gmail.com" style="color:#B8943C;text-decoration:none;">jcnay157@gmail.com</a> · <a href="https://wa.me/19086774196" style="color:#B8943C;text-decoration:none;">WhatsApp</a></p>
      <p style="font-size:10px;color:rgba(92,26,36,0.3);margin:8px 0 0;">© 2026 Jonara Beauty · Elizabeth, NJ</p>
    </div>

  </div>
</body>
</html>`
      }),
    });

    console.log("Order confirmation sent to:", customerEmail);

    // Also notify admin
    const adminEmail = process.env.ADMIN_EMAIL || fromEmail;
    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": brevoKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Jonara Beauty Orders", email: fromEmail },
        to: [{ email: adminEmail }],
        subject: `🛍 New Order #${orderId} — $${total} USD`,
        htmlContent: `
<div style="font-family:Georgia,serif;max-width:480px;margin:20px auto;background:#FDF9F7;border:1px solid rgba(92,26,36,0.12);border-radius:4px;overflow:hidden;">
  <div style="background:#5C1A24;padding:20px 28px;">
    <p style="color:#FAF6EF;font-size:16px;font-weight:300;letter-spacing:4px;text-transform:uppercase;margin:0;">🛍 New Order Received</p>
  </div>
  <div style="padding:24px 28px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(92,26,36,.45);padding:8px 0;border-bottom:1px solid rgba(92,26,36,.08);">Order</td><td style="font-size:13px;color:#5C1A24;font-weight:500;padding:8px 0;border-bottom:1px solid rgba(92,26,36,.08);">#${orderId}</td></tr>
      <tr><td style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(92,26,36,.45);padding:8px 0;border-bottom:1px solid rgba(92,26,36,.08);">Customer</td><td style="font-size:13px;color:#5C1A24;padding:8px 0;border-bottom:1px solid rgba(92,26,36,.08);">${customerName}</td></tr>
      <tr><td style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(92,26,36,.45);padding:8px 0;border-bottom:1px solid rgba(92,26,36,.08);">Email</td><td style="font-size:13px;color:#5C1A24;padding:8px 0;border-bottom:1px solid rgba(92,26,36,.08);">${customerEmail}</td></tr>
      <tr><td style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(92,26,36,.45);padding:8px 0;">Total</td><td style="font-size:20px;color:#B8943C;font-weight:300;padding:8px 0;">$${total} USD</td></tr>
    </table>
    <div style="margin-top:20px;">
      <a href="https://jonarabeauty.vercel.app/admin" style="display:inline-block;background:#5C1A24;color:#FAF6EF;padding:11px 24px;text-decoration:none;font-size:10px;letter-spacing:2px;text-transform:uppercase;border-radius:2px;">View in Admin →</a>
    </div>
  </div>
</div>`
      }),
    });

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(200).json({ received: true });
  }
};
