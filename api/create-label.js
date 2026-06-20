const EasyPost      = require("@easypost/api");
const { db }        = require("./_firebase");
const { requireAdmin } = require("./_auth");
const { rateLimit }    = require("./_ratelimit");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireAdmin(req)) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const rl = await rateLimit(req, { action: "create-label", maxAttempts: 30, windowMs: 60 * 60 * 1000 });
  if (!rl.allowed) return res.status(429).json({ error: "Demasiadas solicitudes." });

  const { order } = req.body || {};
  if (!order?.id) return res.status(400).json({ error: "Falta order.id" });

  const client = new EasyPost(process.env.EASYPOST_API_KEY);

  try {
    const totalQty = (order.items || []).reduce((s, i) => s + (i.qty || 1), 0);
    const weightOz = Math.min(Math.max(totalQty * 0.5 + 1.5, 2), 8);
    const needsBox = totalQty > 3;

    // ── From address ──────────────────────────────────────────
    const fromAddress = await client.Address.create({
      name:    process.env.BUSINESS_NAME   || "Jonara Beauty",
      street1: process.env.BUSINESS_STREET || "1004 1/2 Fanny St Apt 1F",
      city:    process.env.BUSINESS_CITY   || "Elizabeth",
      state:   process.env.BUSINESS_STATE  || "NJ",
      zip:     process.env.BUSINESS_ZIP    || "07201",
      country: "US",
      phone:   process.env.BUSINESS_PHONE  || "9086774196",
    });

    // ── To address ────────────────────────────────────────────
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
      verify:  ["delivery"],
    });

    if (toAddress.verifications?.delivery?.success === false) {
      const msgs = toAddress.verifications.delivery.errors?.map(e => e.message).join(", ");
      return res.status(400).json({ error: `Dirección no válida: ${msgs || "no verificada"}` });
    }

    // ── Parcel ────────────────────────────────────────────────
    const parcel = await client.Parcel.create(
      needsBox
        ? { length: 8, width: 6, height: 3, weight: weightOz }
        : { length: 6, width: 4, height: 2, weight: weightOz }
    );

    // ── Shipment + rates ──────────────────────────────────────
    const shipment = await client.Shipment.create({
      from_address: fromAddress,
      to_address:   toAddress,
      parcel,
    });

    // En EasyPost v8 lowestRate es un método del objeto shipment devuelto
    // Se filtra por carrier USPS
    const rates = shipment.rates || [];
    const uspsRates = rates.filter(r => r.carrier === "USPS");
    if (!uspsRates.length) {
      return res.status(500).json({ error: "No se encontraron tarifas USPS disponibles" });
    }
    // Ordenar por precio y tomar la más barata
    const rate = uspsRates.sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate))[0];

    // ── Buy label ─────────────────────────────────────────────
    const purchased = await client.Shipment.buy(shipment.id, rate.id);

    const labelData = {
      trackingNumber: purchased.tracking_code,
      trackingUrl:    `https://tools.usps.com/go/TrackConfirmAction?tLabels=${purchased.tracking_code}`,
      labelUrl:       purchased.postage_label?.label_url,
      carrier:        rate.carrier,
      service:        rate.service,
      rate:           rate.rate,
      shipmentId:     purchased.id,
      labelCreatedAt: new Date().toISOString(),
      status:         "labeled",
    };

    // ── Guardar en Firestore ───────────────────────────────────
    try {
      await db.collection("orders").doc(order.id).set(
        {
          ...labelData,
          orderId:      order.id,
          customerName: order.customerName,
          email:        order.email,
          total:        order.total,
          updatedAt:    new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (dbErr) {
      console.error("Firestore save (non-fatal):", dbErr.message);
    }

    return res.status(200).json(labelData);

  } catch (err) {
    console.error("EasyPost error:", err.message, err.errors || "");
    return res.status(500).json({
      error: err.message,
      details: err.errors || null,
    });
  }
};
