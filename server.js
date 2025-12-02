import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import sgMail from "@sendgrid/mail";

dotenv.config();

// ---- SendGrid initialisieren ----
if (!process.env.SENDGRID_KEY) {
  console.error("WARNUNG: SENDGRID_KEY ist nicht gesetzt!");
} else {
  sgMail.setApiKey(process.env.SENDGRID_KEY);
}

const app = express();
app.use(express.json());
app.use(cors());

// ------- MongoDB Connection -------
if (!process.env.MONGO_URL) {
  console.error("FEHLER: MONGO_URL ist nicht gesetzt!");
  process.exit(1);
}

const client = new MongoClient(process.env.MONGO_URL);
await client.connect();
const db = client.db("treedelivery");
const orders = db.collection("orders");

// ------- Allowed ZIPs -------
const allowedZips = [
  "57072", "57074", "57076", "57078", "57080",
  "57223", "57234", "57250", "57258", "57271",
  "57290", "57299",
  "57319", "57334", "57339",
  "35708", "35683", "35684", "35685",
  "35745", "57555", "57399", "57610"
];

// ------- PLZ → Ort Mapping -------
const zipToCity = {
  "57072": "Siegen",
  "57074": "Siegen",
  "57076": "Siegen",
  "57078": "Siegen",
  "57080": "Siegen",
  "57223": "Kreuztal",
  "57234": "Wilnsdorf",
  "57250": "Netphen",
  "57258": "Freudenberg",
  "57271": "Hilchenbach",
  "57290": "Neunkirchen",
  "57299": "Burbach",
  "57319": "Bad Berleburg",
  "57334": "Bad Laasphe",
  "57339": "Erndtebrück",
  "57555": "Mudersbach",
  "57399": "Kirchhundem",
  "57610": "Altenkirchen",
  "35708": "Haiger",
  "35683": "Dillenburg",
  "35684": "Dillenburg",
  "35685": "Dillenburg",
  "35745": "Herborn"
};

function getCityByZip(zip) {
  return zipToCity[zip] || null;
}

function normalizeCity(str) {
  return (str || "").trim().toLowerCase();
}

// ------- Datums-Helper -------

/**
 * Liefert true, wenn das gegebene Datum (YYYY-MM-DD)
 * frühestens morgen ist. (Heute ist NICHT erlaubt.)
 */
function isDateAtLeastTomorrow(dateStr) {
  if (!dateStr) return true; // kein Datum ist ok

  const today = new Date();
  const min = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1); // morgen 00:00
  const selected = new Date(dateStr + "T00:00:00");

  return selected >= min;
}

function formatDateGerman(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

// ------- Größe Mappings -------

function mapSizeToShort(size) {
  switch (size) {
    case "small":
      return "S";
    case "medium":
      return "M";
    case "large":
      return "L";
    default:
      return size || "";
  }
}

// ------- E-Mail-Templates (HTML) -------

function buildDeliveryLinesHTML(dateStr) {
  let firstLine;

  if (dateStr) {
    const formatted = formatDateGerman(dateStr);
    firstLine = `Ihr Baum wird am <strong>${formatted}</strong> geliefert.`;
  } else {
    firstLine = `Ihr Baum wird voraussichtlich <strong>in 2&nbsp;Tagen</strong> geliefert.`;
  }

  const secondLine =
    "Sie erhalten kurz vor der Lieferung eine weitere E-Mail mit der genauen Uhrzeit.";

  return `
    <p>${firstLine}</p>
    <p>${secondLine}</p>
  `;
}

function buildBaseEmailHTML({ title, intro, order, includePaymentInfo = true, noteAfterCancel = "" }) {
  const {
    name,
    customerId,
    size,
    street,
    zip,
    city,
    date
  } = order;

  const greetingName = name && name.trim() ? name.trim() : "Kundin, Kunde";
  const sizeShort = mapSizeToShort(size);
  const dateDisplay = date ? formatDateGerman(date) : "Kein Wunschtermin gewählt";

  const deliveryBlock = buildDeliveryLinesHTML(date);

  const myOrderBlock =
    "Mit Ihrer Kunden-ID können Sie Ihre Bestellung auf unserer Website <strong>treedelivery.de</strong> unter „Meine Bestellung“ bearbeiten oder stornieren.";

  const paymentBlock = includePaymentInfo
    ? `<p><strong>Die Bezahlung erfolgt Bar bei Lieferung.</strong></p>`
    : "";

  const cancelNote = noteAfterCancel
    ? `<p>${noteAfterCancel}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>TreeDelivery</title>
<style>
  body {
    background: #0A0F0A;
    margin: 0;
    padding: 0;
    font-family: 'Inter', Arial, sans-serif;
    color: #EDE8D6;
  }

  .wrapper {
    width: 100%;
    padding: 20px 0;
    text-align: center;
  }

  .card {
    background: rgba(20,30,20,0.94);
    border: 1px solid rgba(216,194,122,0.4);
    border-radius: 16px;
    padding: 28px;
    margin: 0 auto;
    max-width: 520px;
    text-align: left;
  }

  h1 {
    color: #FBEAB9;
    font-size: 24px;
    margin-bottom: 10px;
    text-align: center;
  }

  .subtitle {
    text-align: center;
    font-size: 14px;
    color: #D8C27A;
    margin-bottom: 24px;
  }

  .line {
    border-bottom: 1px dashed rgba(255,255,255,0.18);
    margin: 24px 0;
  }

  .data-row {
    margin: 6px 0;
    font-size: 14px;
  }

  .label {
    color: #FBEAB9;
    font-weight: 600;
  }

  .footer {
    margin-top: 24px;
    font-size: 13px;
    color: #D8C27A;
    text-align: center;
    line-height: 1.6;
  }

  .highlight {
    color: #FBEAB9;
    font-weight: 600;
  }

  .gold-box {
    margin: 20px 0;
    background: rgba(216,194,122,0.12);
    border-left: 4px solid #D8C27A;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 14px;
  }

  .tree-icon {
    font-size: 36px;
    text-align: center;
  }

  p {
    font-size: 14px;
    line-height: 1.6;
  }
</style>
</head>

<body>
<div class="wrapper">
  <div class="card">

    <div class="tree-icon">🎄</div>

    <h1>${title}</h1>
    <p class="subtitle">TreeDelivery – Ihr Weihnachtsbaum-Lieferservice</p>

    <p>Guten Tag ${greetingName},</p>

    <p>${intro}</p>

    ${deliveryBlock}

    <div class="line"></div>

    <div class="gold-box">
      <div class="data-row"><span class="label">Kunden-ID:</span> ${customerId}</div>
      <div class="data-row"><span class="label">Baumgröße:</span> ${sizeShort}</div>
      <div class="data-row"><span class="label">Adresse:</span> ${street}, ${zip} ${city}</div>
      <div class="data-row"><span class="label">Lieferdatum:</span> ${dateDisplay}</div>
    </div>

    ${myOrderBlock}
    ${paymentBlock}
    ${cancelNote}

    <div class="footer">
      <br><br>
      Mit freundlichen Grüßen<br>
      <span class="highlight">Ihr TreeDelivery-Team</span>
    </div>

  </div>
</div>
</body>
</html>`;
}

function buildPlainTextSummary({ title, intro, order, includePaymentInfo = true, noteAfterCancel = "" }) {
  const {
    name,
    customerId,
    size,
    street,
    zip,
    city,
    date
  } = order;

  const greetingName = name && name.trim() ? name.trim() : "Kundin, Kunde";
  const sizeShort = mapSizeToShort(size);
  const dateDisplay = date ? formatDateGerman(date) : "Kein Wunschtermin gewählt";

  const dateLine = date
    ? `Ihr Baum wird am ${dateDisplay} geliefert.`
    : `Ihr Baum wird voraussichtlich in 2 Tagen geliefert.`;

  const timeNote = "Sie erhalten kurz vor der Lieferung eine weitere E-Mail mit der genauen Uhrzeit.";

  const myOrder = "Mit Ihrer Kunden-ID können Sie Ihre Bestellung auf unserer Website treedelivery.de unter „Meine Bestellung“ bearbeiten oder stornieren.";
  const payment = includePaymentInfo ? "Die Bezahlung erfolgt Bar bei Lieferung." : "";
  const cancel = noteAfterCancel || "";

  return [
    title,
    "",
    `Guten Tag ${greetingName},`,
    "",
    intro,
    "",
    dateLine,
    timeNote,
    "",
    "Ihre Bestelldaten:",
    `- Kunden-ID: ${customerId}`,
    `- Baumgröße: ${sizeShort}`,
    `- Adresse: ${street}, ${zip} ${city}`,
    `- Lieferdatum: ${dateDisplay}`,
    "",
    myOrder,
    payment,
    cancel,
    "",
    "",
    "Mit freundlichen Grüßen",
    "Ihr TreeDelivery-Team"
  ]
    .filter(Boolean)
    .join("\n");
}

// ------- Kunden-ID Generator -------
function generateId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// ------- Bestellung speichern -------
app.post("/order", async (req, res) => {
  try {
    const data = req.body;
    console.log("Neue Bestellung:", data);

    const { name, size, street, zip, city, email, date } = data;

    // Pflichtfelder prüfen
    if (!name || !size || !street || !zip || !city || !email) {
      return res.status(400).json({ error: "Fehlende Pflichtfelder." });
    }

    // PLZ check
    if (!allowedZips.includes(zip)) {
      return res.status(400).json({ error: "PLZ außerhalb des Liefergebiets." });
    }

    const expectedCity = getCityByZip(zip);
    if (!expectedCity) {
      return res.status(400).json({ error: "Zu dieser PLZ ist kein Ort hinterlegt." });
    }

    if (normalizeCity(expectedCity) !== normalizeCity(city)) {
      return res.status(400).json({ error: "Ort passt nicht zur angegebenen PLZ." });
    }

    // E-Mail check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Ungültige E-Mail-Adresse." });
    }

    // Datum prüfen (falls gesetzt) – nicht früher als morgen
    if (date && !isDateAtLeastTomorrow(date)) {
      return res.status(400).json({ error: "Das Lieferdatum darf nicht früher als morgen liegen." });
    }

    const customerId = generateId();

    const order = {
      ...data,
      name,
      size,
      street,
      zip,
      city: expectedCity,
      email,
      date: date || null,
      customerId,
      createdAt: new Date()
    };

    await orders.insertOne(order);

    // Bestätigungsmail an Kundin/Kunden schicken
    try {
      const fromAddress = process.env.EMAIL_FROM || "bestellung@treedelivery.de";

      const emailConfig = {
        title: "Ihre TreeDelivery-Bestellung ist eingegangen 🎄",
        intro: "vielen Dank für Ihre Bestellung. Nachfolgend finden Sie Ihre Bestelldetails:",
        order,
        includePaymentInfo: true
      };

      await sgMail.send({
        to: email,
        from: fromAddress,
        subject: "Ihre TreeDelivery-Bestellung 🎄",
        text: buildPlainTextSummary(emailConfig),
        html: buildBaseEmailHTML(emailConfig)
      });

      // Optional: Kopie an Admin
      if (process.env.ADMIN_EMAIL) {
        await sgMail.send({
          to: process.env.ADMIN_EMAIL,
          from: fromAddress,
          subject: `Neue TreeDelivery-Bestellung – ${customerId}`,
          text: `Neue Bestellung:\n\n${JSON.stringify(order, null, 2)}`
        });
      }

    } catch (mailErr) {
      console.error("Fehler beim Mailversand via SendGrid:", mailErr);
      return res.json({
        success: true,
        customerId,
        mailWarning: "Bestellung gespeichert, aber E-Mail konnte nicht gesendet werden."
      });
    }

    res.json({ success: true, customerId });

  } catch (err) {
    console.error("Fehler in /order:", err);
    res.status(500).json({ error: "Serverfehler bei der Bestellung." });
  }
});

// ------- Bestellung abrufen -------
app.post("/lookup", async (req, res) => {
  try {
    const { email, customerId } = req.body;

    const result = await orders.findOne({ email, customerId });

    if (!result) {
      return res.status(404).json({ error: "Keine Bestellung gefunden." });
    }

    res.json(result);
  } catch (err) {
    console.error("Fehler in /lookup:", err);
    res.status(500).json({ error: "Serverfehler bei der Suche." });
  }
});

// ------- Bestellung aktualisieren -------
app.post("/update", async (req, res) => {
  try {
    const { email, customerId, size, street, zip, city, date, name } = req.body;

    // Pflichtfelder prüfen
    if (!email || !customerId || !size || !street || !zip || !city) {
      return res.status(400).json({ error: "Fehlende Pflichtfelder." });
    }

    // E-Mail Format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Ungültige E-Mail-Adresse." });
    }

    // PLZ im Liefergebiet
    if (!allowedZips.includes(zip)) {
      return res.status(400).json({ error: "PLZ außerhalb des Liefergebiets." });
    }

    const expectedCity = getCityByZip(zip);
    if (!expectedCity) {
      return res.status(400).json({ error: "Zu dieser PLZ ist kein Ort hinterlegt." });
    }

    if (normalizeCity(expectedCity) !== normalizeCity(city)) {
      return res.status(400).json({ error: "Ort passt nicht zur angegebenen PLZ." });
    }

    // Datum prüfen (falls gesetzt) – nicht früher als morgen
    if (date && !isDateAtLeastTomorrow(date)) {
      return res.status(400).json({ error: "Das Lieferdatum darf nicht früher als morgen liegen." });
    }

    console.log("Update-Request:", { email, customerId, size, street, zip, city, date, name });

    const updateFields = {
      size,
      street,
      zip,
      city: expectedCity,
      date: date || null
    };

    if (typeof name === "string" && name.trim() !== "") {
      updateFields.name = name.trim();
    }

    // 1) Update ausführen
    const updateResult = await orders.updateOne(
      { email, customerId },
      {
        $set: updateFields
      }
    );

    console.log("Update-Result:", updateResult);

    // Nichts gefunden -> 404
    if (!updateResult.matchedCount || updateResult.matchedCount === 0) {
      return res.status(404).json({ error: "Keine Bestellung gefunden." });
    }

    // 2) Aktualisierte Bestellung erneut laden
    const updatedOrder = await orders.findOne({ email, customerId });
    console.log("Updated order from DB:", updatedOrder);

    if (!updatedOrder) {
      return res.status(404).json({ error: "Keine Bestellung gefunden." });
    }

    // 3) Bestätigungsmail für Update
    try {
      const fromAddress = process.env.EMAIL_FROM || "bestellung@treedelivery.de";

      const emailConfig = {
        title: "Ihre TreeDelivery-Bestellung wurde aktualisiert 🎄",
        intro: "wir haben Ihre Bestellung aktualisiert. Nachfolgend finden Sie die aktuellen Bestelldaten:",
        order: updatedOrder,
        includePaymentInfo: true
      };

      await sgMail.send({
        to: email,
        from: fromAddress,
        subject: "Ihre TreeDelivery-Bestellung wurde aktualisiert 🎄",
        text: buildPlainTextSummary(emailConfig),
        html: buildBaseEmailHTML(emailConfig)
      });

      if (process.env.ADMIN_EMAIL) {
        await sgMail.send({
          to: process.env.ADMIN_EMAIL,
          from: fromAddress,
          subject: `TreeDelivery – Bestellung aktualisiert – ${customerId}`,
          text: `Aktualisierte Bestellung:\n\n${JSON.stringify(updatedOrder, null, 2)}`
        });
      }
    } catch (mailErr) {
      console.error("Fehler beim Mailversand (Update):", mailErr);
      return res.json({
        success: true,
        order: updatedOrder,
        mailWarning: "Bestellung aktualisiert, aber E-Mail konnte nicht gesendet werden."
      });
    }

    // 4) Erfolgsantwort
    res.json({ success: true, order: updatedOrder });

  } catch (err) {
    console.error("Fehler in /update:", err);
    res.status(500).json({ error: "Serverfehler bei der Aktualisierung." });
  }
});

// ------- Bestellung stornieren -------
app.post("/delete", async (req, res) => {
  try {
    const { email, customerId } = req.body;
    
    console.log("Delete-Request:", { email, customerId });

    if (!email || !customerId) {
      return res.status(400).json({ error: "Fehlende Pflichtfelder." });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Ungültige E-Mail-Adresse." });
    }

    // Bestellung zuerst holen für Mail
    const existing = await orders.findOne({ email, customerId });
    console.log("Existing order for delete:", existing);

    if (!existing) {
      console.log("Keine Bestellung gefunden für:", { email, customerId });
      return res.status(404).json({ error: "Keine Bestellung gefunden." });
    }

    const deleteResult = await orders.deleteOne({ email, customerId });
    console.log("Delete result:", deleteResult);

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ error: "Keine Bestellung gefunden." });
    }

    // Storno-Mail
    try {
      const fromAddress = process.env.EMAIL_FROM || "bestellung@treedelivery.de";

      const emailConfig = {
        title: "Ihre TreeDelivery-Bestellung wurde storniert 🎄",
        intro: "wir bestätigen Ihnen hiermit die Stornierung Ihrer Bestellung:",
        order: existing,
        includePaymentInfo: false,
        // zusätzlicher Hinweis: keine Lieferung / keine Zahlung
        noteAfterCancel: "Es erfolgt keine Lieferung und keine Zahlung mehr."
      };

      await sgMail.send({
        to: email,
        from: fromAddress,
        subject: "Ihre TreeDelivery-Bestellung wurde storniert 🎄",
        text: buildPlainTextSummary(emailConfig),
        html: buildBaseEmailHTML(emailConfig)
      });

      if (process.env.ADMIN_EMAIL) {
        await sgMail.send({
          to: process.env.ADMIN_EMAIL,
          from: fromAddress,
          subject: `TreeDelivery – Bestellung storniert – ${customerId}`,
          text: `Stornierte Bestellung:\n\n${JSON.stringify(existing, null, 2)}`
        });
      }
    } catch (mailErr) {
      console.error("Fehler beim Mailversand (Delete):", mailErr);
      return res.json({
        success: true,
        mailWarning: "Bestellung storniert, aber E-Mail konnte nicht gesendet werden."
      });
    }

    res.json({ success: true });

  } catch (err) {
    console.error("Fehler in /delete:", err);
    res.status(500).json({ error: "Serverfehler bei der Stornierung." });
  }
});


// ------- Health-Check -------
app.get("/", (req, res) => {
  res.send("TreeDelivery Backend läuft ✅");
});

// ------- Start Server -------
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Server läuft auf Port", port);
});
