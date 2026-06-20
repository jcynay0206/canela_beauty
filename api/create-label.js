// POST /api/create-label
// Crea un label de envío via EasyPost y guarda el resultado en Firestore
// (colección "orders", documento con el Stripe session ID) para que el
// tracking number persista entre dispositivos y recargas del admin.
//
// Variables de entorno requeridas:
//   EASYPOST_API_KEY      — clave de producción de EasyPost
//   BUSINESS_NAME         — nombre en el from address
//   BUSINESS_STREET       — dirección de origen
//   BUSINESS_CITY         — ciudad de origen
//   BUSINESS_STATE        — estado de origen (ej. NJ)
//   BUSINESS_ZIP          — zip de origen
//   BUSINESS_PHONE        — teléfono de origen

const EasyPost  = require("@easypost/api");
const { db }    = require("./_firebase");
const { requireAdmin } = require("./_auth");
const { rateLimit }    = require("./_ratelimit");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Solo el admin puede crear labels
  if (!requireAdmin(req)) {
    return res.status(401).json({ error: "No autorizado" });
  }

  // Rate limit: máx 30 labels por hora (protege contra uso accidental)
  const rl = await rateLimit(req, { action: "create-label", maxAttempts: 30, windowMs: 60 * 60 * 1000 });
  if (!rl.allowed) {
    return res.status(429).json({ error: "Demasiadas solicitudes. Espera unos minutos." });
  }

  const { order } = req.body || {};
  if (!order || !order.id) {
    return res.status(400).json({ error: "Falta el objeto order con id" });
  }

  // Calcular peso dinámico según cantidad de ítems
  // Cada gloss ~0.3 oz, caja mínima 2 oz, máximo razonable 8 oz
  const totalQty  = (order.items || []).reduce((s, i) => s + (i.qty || 1), 0);
  const weightOz  = Math.min(Math.max(totalQty * 0.5 + 1.5, 2), 8);
  const needsBox  = totalQty > 3;

  const client = new EasyPost(process.env.EASYPOST_API_KEY);

  try {
    // From address — tu negocio
    const fromAddress = await client.Address.create({
      name:    process.env.BUSINESS_NAME   || "Jonara Beauty",
      street1: process.env.BUSINESS_STREET || "1004 1/2 Fanny St Apt 1F",
      city:    process.env.BUSINESS_CITY   || "Elizabeth",
      state:   process.env.BUSINESS_STATE  || "NJ",
      zip:     process.env.BUSINESS_ZIP    || "07201",
      country: "US",
      phone:   process.env.BUSINESS_PHONE  || "9086774196",
    });

    // To address — cliente del pedido
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
      verify:  ["delivery"], // EasyPost valida que la dirección existe
    });

    // Verificar que la dirección sea entregable
    if (toAddress.verifications?.delivery?.success === false) {
      const msgs = toAddress.verifications.delivery.errors?.map(e => e.message).join(", ");
      return res.status(400).json({ error: `Dirección no válida: ${msgs || "no verificada"}` });
    }

    // Paquete — dimensiones según tipo de empaque
    const parcel = await client.Parcel.create(
      needsBox
        ? { length: 8, width: 6, height: 3, weight: weightOz }   // caja
        : { length: 6, width: 4, height: 2, weight: weightOz }   // sobre acolchado
    );

    // Crear shipment y obtener tarifas
    const shipment = await client.Shipment.create({
      from_address: fromAddress,
      to_address:   toAddress,
      parcel,
    });

    // Elegir la tarifa más barata de USPS
    const rate = shipment.lowestRate(["USPS"]);
    if (!rate) {
      return res.status(500).json({ error: "No se encontraron tarifas de USPS disponibles" });
    }

    // Comprar el label
    const purchased = await client.Shipment.buy(shipment.id, rate.id);

    const labelData = {
      trackingNumber: purchased.tracking_code,
      trackingUrl:    `https://tools.usps.com/go/TrackConfirmAction?tLabels=${purchased.tracking_code}`,
      labelUrl:       purchased.postage_label.label_url,
      carrier:        rate.carrier,
      service:        rate.service,
      rate:           rate.rate,
      shipmentId:     purchased.id,
      labelCreatedAt: new Date().toISOString(),
      status:         "labeled",
    };

    // Guardar en Firestore para persistencia entre dispositivos
    // Documento: orders/{stripeSessionId}
    try {
      await db.collection("orders").doc(order.id).set(
        {
          ...labelData,
          orderId:       order.id,
          customerName:  order.customerName,
          email:         order.email,
          total:         order.total,
          updatedAt:     new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (dbErr) {
      // Si Firestore falla, igual devolvemos el label — el admin puede imprimirlo
      console.error("Firestore save error (non-fatal):", dbErr.message);
    }

    return res.status(200).json(labelData);

  } catch (err) {
    console.error("EasyPost error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
