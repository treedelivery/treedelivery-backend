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

// ------- Konstanten -------
const FROM = "bestellung@treedelivery.de";
const ADMIN = process.env.ADMIN_EMAIL || "kontakt@treedelivery.de";

const allowedZips = [
  "57072","57074","57076","57078","57080",
  "57223","57234","57250","57258","57271",
  "57290","57299",
  "57319","57334","57339",
  "35708","35683","35684","35685",
  "35745","57555","57399","57610"
];

function generateId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// ------- Bestellung speichern -------
app.post("/order", async (req, res) => {
  try {
    const data = req.body;

    if (!allowedZips.includes(data.zip)) {
      return res.status(400).json({ error: "PLZ außerhalb des Liefergebiets" });
    }

    const existing = await orders.findOne({ email: data.email });
    if (existing) {
      return res.status(400).json({
        error: "Für diese E-Mail existiert bereits eine Bestellung."
      });
    }

    const customerId = generateId();
    const order = { ...data, customerId, createdAt: new Date() };

    await orders.insertOne(order);

    // Kundenmail
    try {
      await sgMail.send({
        to: data.email,
        from: FROM,
        subject: "Deine TreeDelivery-Bestellung 🎄",
        text: `
Danke für deine Bestellung!

Kunden-ID: ${customerId}
Größe: ${data.size}
Adresse: ${data.street}, ${data.zip} ${data.city}
Lieferdatum: ${data.date || "Kein Termin"}

Viele Grüße
TreeDelivery
        `.trim()
      });

      // Admin Benachrichtigung
      await sgMail.send({
        to: ADMIN,
        from: FROM,
        subject: `Neue Bestellung – ${customerId}`,
        text: JSON.stringify(order, null, 2)
      });

    } catch (err) {
      console.error("MAIL FEHLER /order:", err);
    }

    res.json({ success: true, customerId });

  } catch (err) {
    console.error("Fehler in /order:", err);
    res.status(500).json({ error: "Serverfehler" });
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
    res.status(500).json({ error: "Serverfehler" });
  }
});

// ------- Bestellung aktualisieren -------
app.post("/update", async (req, res) => {
  try {
    const { email, customerId, size, street, zip, city, date } = req.body;

    const result = await orders.findOneAndUpdate(
      { email, customerId },
      { $set: { size, street, zip, city, date } },
      { returnDocument: "after" }
    );

    if (!result.value) {
      return res.status(404).json({ error: "Keine Bestellung gefunden." });
    }

    const updated = result.value;

    // Email an Kunde + Admin
    try {
      await sgMail.send({
        to: email,
        from: FROM,
        subject: "Deine TreeDelivery Bestellung wurde geändert ✏️",
        text: `
Deine Bestellung wurde erfolgreich geändert.

Neue Daten:
Größe: ${updated.size}
Adresse: ${updated.street}, ${updated.zip} ${updated.city}
Lieferdatum: ${updated.date || "Kein Termin"}

Kunden-ID: ${customerId}
        `.trim()
      });

      await sgMail.send({
        to: ADMIN,
        from: FROM,
        subject: `Bestellung geändert – ${customerId}`,
        text: JSON.stringify(updated, null, 2)
      });

    } catch (err) {
      console.error("MAIL FEHLER /update:", err);
    }

    res.json({ success: true, updated });

  } catch (err) {
    console.error("Fehler in /update:", err);
    res.status(500).json({ error: "Serverfehler" });
  }
});

// ------- Bestellung löschen -------
app.post("/delete", async (req, res) => {
  try {
    const { email, customerId } = req.body;

    const deleted = await orders.findOneAndDelete({ email, customerId });

    if (!deleted.value) {
      return res.status(404).json({ error: "Keine Bestellung gefunden." });
    }

    // EMAIL AN KUNDE + ADMIN
    try {
      await sgMail.send({
        to: email,
        from: FROM,
        subject: "Deine TreeDelivery Bestellung wurde storniert ❌",
        text: `
Deine Bestellung wurde erfolgreich storniert.

Kunden-ID: ${customerId}
        `.trim()
      });

      await sgMail.send({
        to: ADMIN,
        from: FROM,
        subject: `Bestellung storniert – ${customerId}`,
        text: JSON.stringify(deleted.value, null, 2)
      });

    } catch (err) {
      console.error("MAIL FEHLER /delete:", err);
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
