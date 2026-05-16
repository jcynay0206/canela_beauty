const EasyPost = require("@easypost/api");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const client = new EasyPost(process.env.EASYPOST_API_KEY);

  try {
    const { order } = req.body;

    // From address = Canela Beauty (pulled from env vars)
    const fromAddress = await client.Address.create({
      name:    process.env.BUSINESS_NAME    || "Canela Beauty",
      street1: process.env.BUSINESS_STREET  || "1004 1/2 Fanny St Apt 1F",
      city:    process.env.BUSINESS_CITY    || "Elizabeth",
      state:   process.env.BUSINESS_STATE   || "NJ",
      zip:     process.env.BUSINESS_ZIP     || "07201",
      country: "US",
      phone:   process.env.BUSINESS_PHONE   || "9086774196",
    });

    // To address = customer from Stripe order
    const toAddress = await client.Address.create({
      name:    order.customerName,
      street1: order.street1,
      street2: order.street2 || "",
      city:    order.city,
      state:   order.state,
      zip:     order.zip,
      country: order.country || "US",
      phone:   order.phone   || "",
      email:   order.email,
    });

    // Parcel — gloss products are light
    const parcel = await client.Parcel.create({
      length: 6,   // inches
      width:  4,
      height: 2,
      weight: 4,   // oz — adjust per order qty
    });

    // Create shipment and get rates
    const shipment = await client.Shipment.create({
      from_address: fromAddress,
      to_address:   toAddress,
      parcel,
    });

    // Auto-pick cheapest USPS rate
    const rate = shipment.lowestRate(["USPS"]);

    // Buy the label
    const purchased = await client.Shipment.buy(shipment.id, rate.id);

    res.status(200).json({
      trackingNumber: purchased.tracking_code,
      trackingUrl:    `https://tools.usps.com/go/TrackConfirmAction?tLabels=${purchased.tracking_code}`,
      labelUrl:       purchased.postage_label.label_url,  // PDF to print
      carrier:        rate.carrier,
      service:        rate.service,
      rate:           rate.rate,
      shipmentId:     purchased.id,
    });

  } catch (err) {
    console.error("EasyPost error:", err.message);
    res.status(500).json({ error: err.message });
  }
}
