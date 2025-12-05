import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import sgMail from "@sendgrid/mail";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// -------------------------------------------------------
// Express Setup
// -------------------------------------------------------
const app = express();

app.use(express.json());
app.use(cors());

// -------------------------------------------------------
// File-path Setup (damit sendFile funktioniert)
// -------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------------------------------------------
// SendGrid Setup
// -------------------------------------------------------
if (!process.env.SENDGRID_KEY) {
  console.error("WARNUNG: SENDGRID_KEY ist nicht gesetzt!");
} else {
  sgMail.setApiKey(process.env.SENDGRID_KEY);
}

// -------------------------------------------------------
// MongoDB Connection
// -------------------------------------------------------
if (!process.env.MONGO_URL) {
  console.error("FEHLER: MONGO_URL ist nicht gesetzt!");
  process.exit(1);
}

const client = new MongoClient(process.env.MONGO_URL);
await client.connect();
const db = client.db("treedelivery");
const orders = db.collection("orders");

// -------------------------------------------------------
// Admin Auth Setup
// -------------------------------------------------------
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const SECRET = process.env.ADMIN_SECRET;

// Middleware für JWT-geschützte Admin-Routen
function adminAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(403).json({ error: "Kein Token" });

  try {
    const token = header.split(" ")[1];
    jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(403).json({ error: "Token ungültig" });
  }
}

// -------------------------------------------------------
// Admin Login API (liefert JWT Token)
// -------------------------------------------------------
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ admin: true }, SECRET, { expiresIn: "12h" });
    return res.json({ success: true, token });
  }

  res.json({ success: false });
});

// -------------------------------------------------------
// Preise, PLZ, City Mapping, Utilities
// -------------------------------------------------------
const allowedZips = [
  "57072", "57074", "57076", "57078", "57080",
  "57223", "57234", "57250", "57258", "57271",
  "57290", "57299",
  "57319", "57334", "57339",
  "35708", "35683", "35684", "35685",
  "35745", "57555", "57399", "57610"
];

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

const PRICES = {
  small: 59,
  medium: 79,
  large: 99,
  xl: 129
};

app.get("/prices", (req, res) => {
  res.json(PRICES);
});

function getCityByZip(zip) {
  return zipToCity[zip] || null;
}

function normalizeCity(str) {
  return (str || "").trim().toLowerCase();
}

const DELIVERY_MAX_DATE_STR = "2025-12-24";

function isDateAtLeastTomorrow(dateStr) {
  if (!dateStr) return true;
  const today = new Date();
  const min = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const selected = new Date(dateStr + "T00:00:00");
  return selected >= min;
}

function isDateNotAfterMax(dateStr) {
  if (!dateStr) return true;
  const selected = new Date(dateStr + "T00:00:00");
  const max = new Date(DELIVERY_MAX_DATE_STR + "T23:59:59");
  return selected <= max;
}

function formatDateGerman(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`;
}

// -------------------------------------------------------
// E-Mail HTML Template
// -------------------------------------------------------
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

function buildBaseEmailHTML({ title, intro, order, includePaymentInfo = true, includeCancelRule = true, noteAfterCancel = "" }) {
  const {
    name,
    customerId,
    size,
    street,
    zip,
    city,
    date,
    specialRequests
  } = order;

  const greetingName = name && name.trim() ? name.trim() : "Kundin, Kunde";
  const sizeShort = mapSizeToShort(size);
  const dateDisplay = date ? formatDateGerman(date) : "Kein Wunschtermin gewählt";

  const deliveryBlock = buildDeliveryLinesHTML(date);

  const myOrderBlock =
    "Mit Ihrer Kunden-ID können Sie Ihre Bestellung auf unserer <strong>Website</strong> unter „Meine Bestellung“ bearbeiten oder stornieren.";

  const paymentBlock = includePaymentInfo
    ? `<p><strong>Die Bezahlung erfolgt Bar bei Lieferung.</strong></p>`
    : "";

  const cancelRuleBlock = includeCancelRule
    ? `<p>Sie können Ihre Bestellung bis spätestens <strong>24 Stunden vor dem Liefertermin</strong> stornieren.</p>`
    : "";

  const specialBlock = specialRequests
    ? `<p class="data-row"><span class="label">Spezielle Wünsche:</span><br>${String(specialRequests).replace(/\n/g, "<br>")}</p>`
    : "";

  const cancelNote = noteAfterCancel
    ? `<p>${noteAfterCancel}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>TreeDelivery</title>
<meta name="color-scheme" content="light">
<style>
  body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    background: #f5f5f5;
    color: #222222;
  }

  .wrapper {
    width: 100%;
    padding: 20px 0;
    text-align: center;
  }

  .card {
    background: #ffffff;
    border: 1px solid #e2e2e2;
    border-radius: 16px;
    padding: 22px 18px 24px;
    margin: 0 auto;
    max-width: 520px;
    text-align: left;
    box-shadow: 0 6px 18px rgba(0,0,0,0.06);
  }

  h1 {
    color: #2f2b1b;
    font-size: 22px;
    margin-bottom: 8px;
    text-align: center;
  }

  .subtitle {
    text-align: center;
    font-size: 14px;
    color: #8d7b3d;
    margin-bottom: 18px;
  }

  h2 {
    font-size: 15px;
    margin: 16px 0 6px;
    color: #2f2b1b;
  }

  .section {
    margin-top: 10px;
  }

  .line {
    border-bottom: 1px solid rgba(0,0,0,0.08);
    margin: 14px 0 10px;
  }

  .data-row {
    margin: 4px 0;
    font-size: 14px;
  }

  .label {
    color: #2f2b1b;
    font-weight: 600;
  }

  .footer {
    margin-top: 20px;
    font-size: 13px;
    color: #6b5d33;
    text-align: center;
    line-height: 1.6;
  }

  .highlight {
    color: #2f2b1b;
    font-weight: 600;
  }

  .gold-box {
    margin: 10px 0 14px;
    background: #fdf8eb;
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 14px;
  }

  .tree-icon {
    font-size: 34px;
    text-align: center;
  }

  p {
    font-size: 14px;
    line-height: 1.6;
    margin: 6px 0;
    color: #222222;
  }

  .id-row {
    margin-bottom: 10px;
  }

  .id-label {
    font-size: 14px;
  }

  .id-copy-box {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }

  .id-input {
    flex: 1;
    padding: 6px 8px;
    font-size: 14px;
    border-radius: 6px;
    border: 1px solid #d8c27a;
    background: #fffdf3;
    color: #222222;
  }

  .id-input:focus {
    outline: none;
    border-color: #b89f4a;
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

    <div class="section">
      ${deliveryBlock}
    </div>

    <div class="line"></div>

    <div class="section">
      <h2>Ihre Kunden-ID</h2>
      <div class="gold-box">
        <div class="id-row">
          <span class="id-label"><span class="label">Kunden-ID:</span></span>
          <div class="id-copy-box">
            <input class="id-input" type="text" value="${customerId}" readonly>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Bestelldaten</h2>
      <p class="data-row"><span class="label">Baumgröße:</span> ${sizeShort}</p>
      <p class="data-row"><span class="label">Adresse:</span> ${street}, ${zip} ${city}</p>
      <p class="data-row"><span class="label">Lieferdatum:</span> ${dateDisplay}</p>
      ${specialBlock}
    </div>

    <div class="section">
      <h2>Bearbeitung & Stornierung</h2>
      <p>${myOrderBlock}</p>
      ${cancelRuleBlock}
    </div>

    <div class="section">
      <h2>Zahlung</h2>
      ${paymentBlock}
      ${cancelNote}
    </div>

    <div class="footer">
      Mit freundlichen Grüßen<br>
      <span class="highlight">Ihr TreeDelivery-Team</span>
    </div>

  </div>
</div>
</body>
</html>`;
}

// -------------------------------------------------------
// Plaintext fallback
// -------------------------------------------------------
function buildPlainTextSummary({ title, intro, order, includePaymentInfo = true, includeCancelRule = true, noteAfterCancel = "" }) {
  const {
    name,
    customerId,
    size,
    street,
    zip,
    city,
    date,
    specialRequests
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
  const cancelRule = includeCancelRule ? "Sie können Ihre Bestellung bis spätestens 24 Stunden vor dem Liefertermin stornieren." : "";
  const cancel = noteAfterCancel || "";
  const special = specialRequests ? `Spezielle Wünsche: ${specialRequests}` : "";

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
    "Ihre Kunden-ID:",
    customerId,
    "",
    "Bestelldaten:",
    `- Baumgröße: ${sizeShort}`,
    `- Adresse: ${street}, ${zip} ${city}`,
    `- Lieferdatum: ${dateDisplay}`,
    special,
    "",
    "Bearbeitung & Stornierung:",
    myOrder,
    cancelRule,
    cancel,
    "",
    "Zahlung:",
    payment,
    "",
    "Mit freundlichen Grüßen",
    "Ihr TreeDelivery-Team"
  ]
    .filter(Boolean)
    .join("\n");
}

// -------------------------------------------------------
// Kunden-ID Generator
// -------------------------------------------------------
function generateId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// -------------------------------------------------------
// Bestellung speichern (/order)
// -------------------------------------------------------
app.post("/order", async (req, res) => {
  try {
    const data = req.body;
    console.log("Neue Bestellung:", data);

    const { name, size, street, zip, city, email, date, specialRequests } = data;

    if (!name || !size || !street || !zip || !city || !email) {
      return res.status(400).json({ error: "Fehlende Pflichtfelder." });
    }

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

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Ungültige E-Mail-Adresse." });
    }

    if (date) {
      if (!isDateAtLeastTomorrow(date)) {
        return res.status(400).json({ error: "Das Lieferdatum darf nicht früher als morgen liegen." });
      }
      if (!isDateNotAfterMax(date)) {
        return res.status(400).json({ error: "Das Lieferdatum darf nicht nach dem 24.12.2025 liegen." });
      }
    }

    const existingOrder = await orders.findOne({ email });
    if (existingOrder) {
      return res.status(400).json({
        error:
          "Für diese E-Mail-Adresse liegt bereits eine Bestellung vor. Bitte nutzen Sie den Bereich „Meine Bestellung“, um diese zu bearbeiten oder zu stornieren."
      });
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
      specialRequests: specialRequests || null,
      customerId,
      createdAt: new Date()
    };

    await orders.insertOne(order);

    try {
      const fromAddress = process.env.EMAIL_FROM || "bestellung@treedelivery.de";

      const emailConfig = {
        title: "Ihre TreeDelivery-Bestellung ist eingegangen 🎄",
        intro: "vielen Dank für Ihre Bestellung. Nachfolgend finden Sie Ihre Bestelldaten:",
        order,
        includePaymentInfo: true,
        includeCancelRule: true
      };

      await sgMail.send({
        to: email,
        from: fromAddress,
        subject: "Ihre TreeDelivery-Bestellung 🎄",
        text: buildPlainTextSummary(emailConfig),
        html: buildBaseEmailHTML(emailConfig)
      });

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

// -------------------------------------------------------
// Bestellung abrufen (/lookup)
// -------------------------------------------------------
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

// -------------------------------------------------------
// Bestellung aktualisieren (/update)
// -------------------------------------------------------
app.post("/update", async (req, res) => {
  try {
    const { email, customerId, size, street, zip, city, date, name, specialRequests } = req.body;

    if (!email || !customerId || !size || !street || !zip || !city) {
      return res.status(400).json({ error: "Fehlende Pflichtfelder." });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Ungültige E-Mail-Adresse." });
    }

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

    if (date) {
      if (!isDateAtLeastTomorrow(date)) {
        return res.status(400).json({ error: "Das Lieferdatum darf nicht früher als morgen liegen." });
      }
      if (!isDateNotAfterMax(date)) {
        return res.status(400).json({ error: "Das Lieferdatum darf nicht nach dem 24.12.2025 liegen." });
      }
    }

    console.log("Update-Request:", { email, customerId, size, street, zip, city, date, name, specialRequests });

    const updateFields = {
      size,
      street,
      zip,
      city: expectedCity,
      date: date || null,
      specialRequests: specialRequests || null
    };

    if (typeof name === "string" && name.trim() !== "") {
      updateFields.name = name.trim();
    }

    // Update durchführen
    const updateResult = await orders.updateOne(
      { email, customerId },
      { $set: updateFields }
    );

    if (!updateResult.matchedCount) {
      return res.status(404).json({ error: "Keine Bestellung gefunden." });
    }

    const updatedOrder = await orders.findOne({ email, customerId });

    if (!updatedOrder) {
      return res.status(404).json({ error: "Keine Bestellung gefunden." });
    }

    // E-Mail nach Update
    try {
      const fromAddress = process.env.EMAIL_FROM || "bestellung@treedelivery.de";

      const emailConfig = {
        title: "Ihre TreeDelivery-Bestellung wurde aktualisiert 🎄",
        intro: "wir haben Ihre Bestellung aktualisiert. Nachfolgend finden Sie die aktuellen Bestelldaten:",
        order: updatedOrder,
        includePaymentInfo: true,
        includeCancelRule: true
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

    res.json({ success: true, order: updatedOrder });

  } catch (err) {
    console.error("Fehler in /update:", err);
    res.status(500).json({ error: "Serverfehler bei der Aktualisierung." });
  }
});

// -------------------------------------------------------
// Bestellung stornieren (/delete)
// -------------------------------------------------------
function getPlannedDeliveryDate(order) {
  if (order.date) {
    return new Date(order.date + "T00:00:00");
  }
  const created = new Date(order.createdAt || new Date());
  const planned = new Date(created.getTime());
  planned.setDate(planned.getDate() + 2);
  return planned;
}

function isCancelableNow(order) {
  const deliveryDate = getPlannedDeliveryDate(order);
  const cutoff = new Date(deliveryDate.getTime() - 24 * 60 * 60 * 1000);
  const now = new Date();
  return now <= cutoff;
}

app.post("/delete", async (req, res) => {
  try {
    const { email, customerId } = req.body;

    if (!email || !customerId) {
      return res.status(400).json({ error: "Fehlende Pflichtfelder." });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Ungültige E-Mail-Adresse." });
    }

    const existing = await orders.findOne({ email, customerId });

    if (!existing) {
      return res.status(404).json({ error: "Keine Bestellung gefunden." });
    }

    if (!isCancelableNow(existing)) {
      return res.status(400).json({ error: "Eine Stornierung ist nur bis 24 Stunden vor dem Liefertermin möglich." });
    }

    const deleteResult = await orders.deleteOne({ email, customerId });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ error: "Keine Bestellung gefunden." });
    }

    // Bestätigungsmail beim Storno
    try {
      const fromAddress = process.env.EMAIL_FROM || "bestellung@treedelivery.de";

      const emailConfig = {
        title: "Ihre TreeDelivery-Bestellung wurde storniert 🎄",
        intro: "wir bestätigen Ihnen hiermit die Stornierung Ihrer Bestellung:",
        order: existing,
        includePaymentInfo: false,
        includeCancelRule: false,
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
// -------------------------------------------------------
// Admin: Login-Seite öffentlich
// -------------------------------------------------------
app.get("/admin/login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin", "login.html"));
});

// -------------------------------------------------------
// Admin: alle anderen Dateien geschützt
// -------------------------------------------------------
app.use("/admin", adminAuth, express.static(path.join(__dirname, "admin")));

// -------------------------------------------------------
// Health Check
// -------------------------------------------------------
app.get("/", (req, res) => {
  res.send("TreeDelivery Backend läuft ✅");
});

// -------------------------------------------------------
// Server Start
// -------------------------------------------------------
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Server läuft auf Port", port);
});
