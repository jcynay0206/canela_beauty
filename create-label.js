module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const key = process.env.EASYPOST_API_KEY;
  if (!key) return res.status(500).json({ error: "EasyPost key not configured" });

  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body);
    const { order } = body;

    if (!order) return res.status(400).json({ error: "No order data" });

    // Basic auth — EasyPost uses API key as username, empty password
    const auth = Buffer.from(`${key}:`).toString("base64");
    const headers = {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/json",
    };

    // 1. Create shipment
    const shipmentRes = await fetch("https://api.easypost.com/v2/shipments", {
      method: "POST",
      headers,
      body: JSON.stringify({
        shipment: {
          from_address: {
            name:    process.env.BUSINESS_NAME   || "Jonara Beauty",
            street1: process.env.BUSINESS_STREET || "1004 1/2 Fanny St Apt 1F",
            city:    process.env.BUSINESS_CITY   || "Elizabeth",
            state:   process.env.BUSINESS_STATE  || "NJ",
            zip:     process.env.BUSINESS_ZIP    || "07201",
            country: "US",
            phone:   process.env.BUSINESS_PHONE  || "9086774196",
            email:   process.env.FROM_EMAIL      || "jcnay157@gmail.com",
          },
          to_address: {
            name:    order.customerName,
            street1: order.street1,
            street2: order.street2 || "",
            city:    order.city,
            state:   order.state,
            zip:     order.zip,
            country: order.country || "US",
            email:   order.email,
          },
          parcel: {
            // Default: bubble mailer ~2oz. Adjust per order if needed.
            length: 9,
            width:  6,
            height: 1,
            weight: 2, // oz
          },
        }
      }),
    });

    const shipment = await shipmentRes.json();
    console.log("Shipment created:", shipment.id, "Rates:", shipment.rates?.length);

    if (!shipmentRes.ok || shipment.error) {
      console.error("EasyPost shipment error:", JSON.stringify(shipment.error));
      return res.status(500).json({ error: shipment.error?.message || "Shipment creation failed" });
    }

    // 2. Select cheapest USPS rate
    const uspsRates = (shipment.rates || []).filter(r => r.carrier === "USPS");
    if (!uspsRates.length) {
      return res.status(500).json({ error: "No USPS rates available. Check address." });
    }

    const rate = uspsRates.sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate))[0];
    console.log("Selected rate:", rate.service, rate.rate);

    // 3. Buy the shipment
    const buyRes = await fetch(`https://api.easypost.com/v2/shipments/${shipment.id}/buy`, {
      method: "POST",
      headers,
      body: JSON.stringify({ rate: { id: rate.id } }),
    });

    const purchased = await buyRes.json();
    console.log("Label bought:", purchased.tracking_code);

    if (!buyRes.ok || purchased.error) {
      console.error("EasyPost buy error:", JSON.stringify(purchased.error));
      return res.status(500).json({ error: purchased.error?.message || "Label purchase failed" });
    }

    return res.status(200).json({
      trackingNumber: purchased.tracking_code,
      trackingUrl:    `https://tools.usps.com/go/TrackConfirmAction?tLabels=${purchased.tracking_code}`,
      labelUrl:       purchased.postage_label?.label_url,
      carrier:        rate.carrier,
      service:        rate.service,
      rate:           rate.rate,
    });

  } catch (err) {
    console.error("Create label error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
