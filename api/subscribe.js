module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email } = req.body || {};
  if (!email || !email.includes("@")) return res.status(400).json({ error: "Invalid email" });

  const key = process.env.BREVO_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || "jcnay157@gmail.com";
  const fromName  = process.env.FROM_NAME  || "Jonara Beauty";

  if (!key) return res.status(500).json({ error: "Brevo key not configured" });

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email }],
        subject: "Welcome to Jonara Beauty 💄 — Here's your 10% off",
        htmlContent: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#FDF9F7;font-family:Georgia,serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border:1px solid rgba(92,26,36,0.12);border-radius:4px;overflow:hidden;">

    <div style="background:#5C1A24;padding:28px 36px;text-align:center;">
      <p style="font-size:11px;letter-spacing:5px;text-transform:uppercase;color:rgba(253,249,247,0.6);margin:0 0 8px">Welcome to</p>
      <p style="font-family:Georgia,serif;font-size:28px;font-weight:300;letter-spacing:6px;text-transform:uppercase;color:#FDF9F7;margin:0;">JONARA <em style="font-style:italic;color:#B8943C">Beauty</em></p>
    </div>

    <div style="padding:40px 36px;text-align:center;">
      <p style="font-size:24px;margin:0 0 8px">💄</p>
      <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:300;color:#5C1A24;margin:0 0 16px;">Thank you for joining<br>the <em style="font-style:italic;color:#B8943C">Jonara family!</em></h1>
      <p style="font-size:14px;color:rgba(92,26,36,0.55);line-height:1.8;margin:0 0 28px;">Made with love. Worn with meaning.<br>Here's a little welcome gift from us to you.</p>

      <div style="background:#FDF9F7;border:1.5px dashed rgba(184,148,60,0.4);border-radius:3px;padding:24px;margin-bottom:28px;display:inline-block;width:80%;">
        <p style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(92,26,36,0.45);margin:0 0 8px;">Your welcome code</p>
        <p style="font-family:Georgia,serif;font-size:36px;font-weight:300;color:#5C1A24;letter-spacing:6px;margin:0 0 6px;">WELCOME10</p>
        <p style="font-size:12px;color:#B8943C;margin:0;">10% off your first order</p>
      </div>

      <p style="font-size:12px;color:rgba(92,26,36,0.4);margin:0 0 28px;">Use at checkout · One time only · Cannot be combined with other offers</p>

      <a href="https://jonarabeauty.vercel.app" style="display:inline-block;background:#5C1A24;color:#FDF9F7;padding:14px 36px;text-decoration:none;font-size:11px;letter-spacing:3px;text-transform:uppercase;border-radius:2px;">Shop Now</a>
    </div>

    <div style="background:#F8F1ED;padding:20px 36px;text-align:center;border-top:1px solid rgba(92,26,36,0.08);">
      <p style="font-size:11px;color:rgba(92,26,36,0.4);margin:0 0 6px;">Questions? Reply to this email or reach us on</p>
      <p style="font-size:11px;color:rgba(92,26,36,0.4);margin:0;">
        <a href="https://instagram.com/jonarabeauty" style="color:#B8943C;text-decoration:none;">Instagram</a> ·
        <a href="https://wa.me/19086774196" style="color:#B8943C;text-decoration:none;">WhatsApp</a>
      </p>
      <p style="font-size:10px;color:rgba(92,26,36,0.3);margin:12px 0 0;">© 2026 Jonara Beauty · Elizabeth, NJ</p>
    </div>

  </div>
</body>
</html>`
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Brevo error:", JSON.stringify(data));
      return res.status(500).json({ error: data.message || "Email failed" });
    }

    console.log("Welcome email sent to:", email);
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("Subscribe error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
