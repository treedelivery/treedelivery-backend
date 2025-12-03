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
      const greetingName = name || "Kundin, Kunde";

      await sgMail.send({
        to: email,
        from: fromAddress,
        subject: "Ihre TreeDelivery-Bestellung 🎄",
        text: `
Hallo ${greetingName},

vielen Dank für Ihre Bestellung bei TreeDelivery!

Ihre Bestelldaten:
- Baumgröße: ${size}
- Straße & Hausnummer: ${street}
- PLZ / Ort: ${zip} ${expectedCity}
- Wunschtermin: ${date || "Kein spezieller Termin gewählt"}
- Kunden-ID: ${customerId}

Mit Ihrer Kunden-ID können Sie Ihre Bestellung später auf unserer Website unter „Meine Bestellung“ aufrufen.

Die Bezahlung erfolgt bar bei Lieferung.

Bitte prüfen Sie auch Ihren Spam- bzw. Werbungsordner,
falls Sie keine E-Mail im Posteingang finden.

Frohe Weihnachten!
Ihr TreeDelivery-Team
        `.trim()
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
      const greetingName = updatedOrder.name || "Kundin, Kunde";

      await sgMail.send({
        to: email,
        from: fromAddress,
        subject: "Ihre TreeDelivery-Bestellung wurde aktualisiert 🎄",
        text: `
Hallo ${greetingName},

Ihre TreeDelivery-Bestellung wurde soeben aktualisiert.

Aktuelle Bestelldaten:
- Kunden-ID: ${customerId}
- Baumgröße: ${updatedOrder.size}
- Adresse: ${updatedOrder.street}, ${updatedOrder.zip} ${updatedOrder.city}
- Lieferdatum: ${updatedOrder.date || "Kein spezieller Termin gewählt"}

Die Bezahlung erfolgt weiterhin bar bei Lieferung.

Bitte prüfen Sie auch Ihren Spam- bzw. Werbungsordner,
falls Sie keine E-Mail im Posteingang finden.

Frohe Weihnachten!
Ihr TreeDelivery-Team
        `.trim()
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
      const greetingName = existing.name || "Kundin, Kunde";

      await sgMail.send({
        to: email,
        from: fromAddress,
        subject: "Ihre TreeDelivery-Bestellung wurde storniert 🎄",
        text: `
Hallo ${greetingName},

Ihre TreeDelivery-Bestellung wurde soeben storniert.

Stornierte Bestellung:
- Kunden-ID: ${customerId}
- Baumgröße: ${existing.size}
- Adresse: ${existing.street}, ${existing.zip} ${existing.city}
- Lieferdatum: ${existing.date || "kein Termin hinterlegt"}

Es erfolgt keine Lieferung und keine Zahlung mehr.

Bitte prüfen Sie auch Ihren Spam- bzw. Werbungsordner,
falls Sie keine E-Mail im Posteingang finden.

Frohe Weihnachten!
Ihr TreeDelivery-Team
        `.trim()
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
