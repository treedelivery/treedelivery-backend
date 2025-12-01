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
  "57072","57074","57076","57078","57080",
  "57223","57234","57250","57258","57271",
  "57290","57299",
  "57319","57334","57339",
  "35708","35683","35684","35685",
  "35745","57555","57399","57610"
];

// ------- Kunden-ID Generator -------
function generateId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// 🟩 ADMIN MAIL ADDRESS
const ADMIN = process.env.ADMIN_EMAIL || "kontakt@treedelivery.de";
const FROM = process.env.EMAIL_FROM || "bestellung@treedelivery.de";

// ------- Bestellung speichern -------
app.post("/order", async (req, res) => {
  try {
    const data = req.body;
    console.log("Neue Bestellung:", data);

    // PLZ check
    if (!allowedZips.includes(data.zip)) {
      return res.status(400).json({ error: "PLZ außerhalb des Liefergebiets" });
    }

    // E-Mail check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return res.status(400).json({ error: "Ungültige E-Mail" });
    }

    // Prüfen, ob es für diese Email schon eine Bestellung gibt
    const existing = await orders.findOne({ email: data.email });
    if (existing) {
      return res.status(400).json({
        error: "Für diese E-Mail existiert bereits eine Bestellung."
      });
    }

    const customerId = generateId();

    const order = {
      ...data,
      customerId,
      createdAt: new Date()
    };

    await orders.insertOne(order);

    // Bestätigungsmail an Kunden
    try {
      await sgMail.send({
        to: data.email,
        from: FROM,
        subject: "Deine TreeDelivery-Bestellung 🎄",
        text: `
Hallo ${data.street || "Kunde"},

vielen Dank für deine Bestellung bei TreeDelivery!

Deine Bestelldaten:
- Baumgröße: ${data.size}
- Straße & Hausnummer: ${data.street}
- PLZ / Ort: ${data.zip} ${data.city}
- Wunschtermin: ${data.date || "Kein spezieller Termin gewählt"}
- Kunden-ID: ${customerId}

Viele Grüße
TreeDelivery-Team
        `.trim()
      });

      // ADMIN erhält Kopie
      await sgMail.send({
        to: ADMIN,
        from: FROM,
        subject: `Neue Bestellung – ${customerId}`,
        text: `Neue Bestellung:\n${JSON.stringify(order, null, 2)}`
      });

    } catch (mailErr) {
      console.error("Fehler Mail /order:", mailErr);
    }

    res.json({ success: true, customerId });

  } catch (err) {
    console.error("Fehler in /order:", err);
    res.status(500).json({ error: "Serverfehler bei der Bestellung" });
  }
});

// ------- Bestellung abrufen -------
app.post("/lookup", async (req, res) => {
  try {
    const { email, customerId } = req.body;

    const result = await orders.findOne({ email, customerId });

    if (!result) {
      return res.status(404).json({ error: "Keine Bestellung gefunden" });
    }

    res.json(result);

  } catch (err) {
    console.error("Fehler in /lookup:", err);
    res.status(500).json({ error: "Serverfehler bei der Suche" });
  }
});

// ------- Bestellung aktualisieren -------
app.post("/update", async (req, res) => {
  console.log("UPDATE REQUEST:", req.body);

  try {
    const { email, customerId, size, street, zip, city, date } = req.body;

    const result = await orders.findOneAndUpdate(
      { email, customerId },
      { $set: { size, street, zip, city, date } },
      { returnDocument: "after" }
    );

    if (!result || !result.value) {
      return res.status(404).json({ error: "Keine Bestellung gefunden." });
    }

    const updated = result.value;

    // Kundemail + Adminmail
    try {
      // Kunde bekommt Änderungsmail
      await sgMail.send({
        to: email,
        from: FROM,
        subject: "Deine TreeDelivery-Bestellung wurde geändert ✏️",
        text: `
Hallo,

deine Bestellung wurde erfolgreich geändert.

Neue Daten:
- Größe: ${updated.size}
- Straße: ${updated.street}
- PLZ/Ort: ${updated.zip} ${updated.city}
- Lieferdatum: ${updated.date || "Kein Termin"}

Kunden-ID: ${customerId}

Viele Grüße
TreeDelivery-Team
        `.trim()
      });

      // ADMIN bekommt Kopie
      await sgMail.send({
        to: ADMIN,
        from: FROM,
        subject: `Bestellung geändert – ${customerId}`,
        text: `Geänderte Bestellung:\n${JSON.stringify(updated, null, 2)}`
      });

    } catch (mailErr) {
      console.error("Fehler Mail /update:", mailErr);
    }

    res.json({ success: true, updated });

  } catch (err) {
    console.error("Fehler in /update:", err);
    res.status(500).json({ error: "Serverfehler" });
  }
});

// ------- Bestellung löschen -------
app.post("/delete", async (req, res) => {
  console.log("DELETE REQUEST:", req.body);

  try {
    const { email, customerId } = req.body;

    const deleted = await orders.findOneAndDelete({ email, customerId });

    if (!deleted || !deleted.value) {
      return res.status(404).json({ error: "Keine Bestellung gefunden." });
    }

    // Kunde + Admin Mails senden
    try {
      // Kunde
      await sgMail.send({
        to: email,
        from: FROM,
        subject: "Deine TreeDelivery-Bestellung wurde storniert ❌",
        text: `
Hallo,

deine Bestellung wurde erfolgreich storniert.

Kunden-ID: ${customerId}

Viele Grüße
TreeDelivery-Team
        `.trim()
      });

      // Admin erhält Storno
      await sgMail.send({
        to: ADMIN,
        from: FROM,
        subject: `Bestellung storniert – ${customerId}`,
        text: `Stornierte Bestellung:\n${JSON.stringify(deleted.value, null, 2)}`
      });

    } catch (mailErr) {
      console.error("Fehler Mail /delete:", mailErr);
    }

    res.json({ success: true });

  } catch (err) {
    console.error("Fehler in /delete:", err);
    res.status(500).json({ error: "Serverfehler" });
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
