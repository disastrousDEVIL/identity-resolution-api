import express, { Request, Response } from "express";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

// 0️⃣ Validate environment variables
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL environment variable is not set!");
  process.exit(1);
}

// Helper function to force IPv4 connection
function getDatabaseUrl() {
  let url = process.env.DATABASE_URL!;
  
  // Log the original URL for debugging
  console.log("🔍 Original DATABASE_URL:", url);
  
  // For Supabase, we need to use the direct connection string
  // The issue is likely that we need to use the correct Supabase connection format
  if (url.includes('supabase.co') || url.includes('pooler.supabase.com')) {
    try {
      // Parse the URL to extract components
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      
      // For Supabase, we should use the direct connection without modifications
      // The issue might be with the connection string format itself
      console.log("🔧 Using original Supabase URL (no modifications needed)");
      
      // Ensure we have the correct SSL settings for Supabase
      if (!url.includes('sslmode=')) {
        url += (url.includes('?') ? '&' : '?') + 'sslmode=require';
      }
      
      // For pooler connections, add specific SSL parameters
      if (url.includes('pooler.supabase.com')) {
        console.log("🔧 Detected Supabase pooler connection");
        if (!url.includes('sslmode=require')) {
          url = url.replace('sslmode=require', 'sslmode=require&ssl=true');
        }
      }
      
      // Add connection parameters for better compatibility
      if (!url.includes('connect_timeout=')) {
        url += (url.includes('?') ? '&' : '?') + 'connect_timeout=30';
      }
      
      // Add application_name for better debugging
      if (!url.includes('application_name=')) {
        url += (url.includes('?') ? '&' : '?') + 'application_name=bitespeed-identity';
      }
      
      console.log("🔧 Final DATABASE_URL:", url);
    } catch (error) {
      console.error("❌ Error processing DATABASE_URL:", error);
      // Fall back to original URL
    }
  }
  
  return url;
}

console.log("🚀 Starting application...");
console.log("📡 Database URL configured:", process.env.DATABASE_URL ? "Yes" : "No");
console.log("🔧 Using modified URL for IPv4 compatibility");

// 1️⃣ Setup express app
const app = express();
app.use(express.json());

// 2️⃣ Setup Postgres pool
const pool = new Pool({
  connectionString: getDatabaseUrl(),
  ssl: {
    rejectUnauthorized: false,
    ca: undefined,
    checkServerIdentity: () => undefined,
    secureProtocol: 'TLSv1_2_method',
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3'
  },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 20,
});

// 3️⃣ Health check for DB
app.get("/testdb", async (req: Request, res: Response) => {
  console.log("🔍 Testing database connection...");
  console.log("📡 DATABASE_URL:", process.env.DATABASE_URL ? "Set" : "Not set");
  
  try {
    console.log("🔌 Attempting to connect to database...");
    const client = await pool.connect();
    console.log("🔌 Connected successfully, running test query...");
    const result = await client.query("SELECT NOW() as current_time, version() as pg_version");
    client.release();
    console.log("✅ Database connection successful");
    console.log("📊 Query result:", result.rows[0]);
    res.json({
      success: true,
      data: result.rows[0],
      message: "Database connection successful"
    });
  } catch (error: any) {
    console.error("❌ DB Test Error:", error.message);
    console.error("🔍 Error details:", error);
    console.error("🔍 Error code:", error.code);
    console.error("🔍 Error errno:", error.errno);
    console.error("🔍 Error syscall:", error.syscall);
    
    res.status(500).json({ 
      error: "Database connection failed", 
      details: error.message,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall
    });
  }
});

// 4️⃣ Identify API
app.post("/identify", async (req: Request, res: Response) => {
  const { email, phoneNumber } = req.body;

  if (!email && !phoneNumber) {
    return res.status(400).json({ error: "Email or phoneNumber required" });
  }

  const client = await pool.connect();
  try {
    // 1️⃣ Fetch all contacts matching email OR phone
    const result = await client.query(
      `SELECT * FROM contact 
       WHERE (email = $1 OR phonenumber = $2) 
       AND deletedat IS NULL`,
      [email, phoneNumber]
    );

    let contacts = result.rows;

    // 2️⃣ If nothing found → insert as new primary
    if (contacts.length === 0) {
      const insert = await client.query(
        `INSERT INTO contact (email, phonenumber, linkprecedence) 
         VALUES ($1, $2, 'primary') 
         RETURNING *`,
        [email, phoneNumber]
      );
      return res.json(buildResponse(insert.rows));
    }

    // 3️⃣ Handle multiple primaries (merge logic)
    const primaries = contacts.filter(c => c.linkprecedence === "primary");
    if (primaries.length > 1) {
      primaries.sort(
        (a, b) => new Date(a.createdat).getTime() - new Date(b.createdat).getTime()
      );
      const finalPrimary = primaries[0];
      const toDemote = primaries.slice(1);

      for (const demoted of toDemote) {
        // Demote this primary
        await client.query(
          `UPDATE contact 
           SET linkprecedence = 'secondary', linkedid = $1, updatedat = NOW() 
           WHERE id = $2`,
          [finalPrimary.id, demoted.id]
        );

        // Update all its children
        await client.query(
          `UPDATE contact 
           SET linkedid = $1, updatedat = NOW() 
           WHERE linkedid = $2`,
          [finalPrimary.id, demoted.id]
        );
      }

      // Re-fetch cluster after merge
      const unified = await client.query(
        `SELECT * FROM contact 
         WHERE id = $1 OR linkedid = $1`,
        [finalPrimary.id]
      );
      contacts = unified.rows;
    }

    // 4️⃣ If request email/phone is new, insert as secondary
    const emailExists = contacts.some(c => c.email === email);
    const phoneExists = contacts.some(c => c.phonenumber === phoneNumber);

    if (!emailExists || !phoneExists) {
      const primary = contacts.find(c => c.linkprecedence === "primary")!;
      const insert = await client.query(
        `INSERT INTO contact (email, phonenumber, linkprecedence, linkedid) 
         VALUES ($1, $2, 'secondary', $3) 
         RETURNING *`,
        [email, phoneNumber, primary.id]
      );
      contacts.push(insert.rows[0]);
    }

    // 5️⃣ Build final response
    res.json(buildResponse(contacts));
  } catch (error: any) {
    console.error("❌ Identify Error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// Helper to format response
function buildResponse(contacts: any[]) {
  const primary = contacts.find(c => c.linkprecedence === "primary")!;
  const emails = Array.from(new Set(contacts.map(c => c.email).filter(Boolean)));
  const phoneNumbers = Array.from(new Set(contacts.map(c => c.phonenumber).filter(Boolean)));
  const secondaryIds = contacts.filter(c => c.linkprecedence === "secondary").map(c => c.id);

  return {
    contact: {
      primaryContactId: primary.id,
      emails,
      phoneNumbers,
      secondaryContactIds: secondaryIds,
    },
  };
}

// 5️⃣ Get all contacts (for debugging)
app.get("/contacts", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT * FROM contact WHERE deletedat IS NULL ORDER BY id"
    );
    res.json(result.rows);
  } catch (error: any) {
    console.error("❌ Contacts Error:", error.message);
    res.status(500).json({ error: "Failed to fetch contacts" });
  } finally {
    client.release();
  }
});

// 6️⃣ Delete specific contact by ID
app.delete("/contacts/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const contactId = parseInt(id);

  if (isNaN(contactId)) {
    return res.status(400).json({ error: "Invalid contact ID" });
  }

  const client = await pool.connect();
  try {
    // Check if contact exists and is not already deleted
    const existingContact = await client.query(
      "SELECT * FROM contact WHERE id = $1 AND deletedat IS NULL",
      [contactId]
    );

    if (existingContact.rows.length === 0) {
      return res.status(404).json({ error: "Contact not found or already deleted" });
    }

    const contact = existingContact.rows[0];

    // If it's a primary contact, handle cascade deletion of linked contacts
    if (contact.linkprecedence === "primary") {
      // Soft delete all secondary contacts linked to this primary
      await client.query(
        "UPDATE contact SET deletedat = NOW(), updatedat = NOW() WHERE linkedid = $1 AND deletedat IS NULL",
        [contactId]
      );
    } else if (contact.linkprecedence === "secondary" && contact.linkedid) {
      // If it's a secondary contact, check if we need to promote another secondary to primary
      const remainingSecondaries = await client.query(
        "SELECT * FROM contact WHERE linkedid = $1 AND id != $2 AND deletedat IS NULL ORDER BY createdat",
        [contact.linkedid, contactId]
      );

      // If this was the only secondary contact, we might want to handle the primary differently
      if (remainingSecondaries.rows.length === 0) {
        // No other secondaries exist, just delete this one
        console.log("Deleting last secondary contact for primary:", contact.linkedid);
      }
    }

    // Soft delete the target contact
    await client.query(
      "UPDATE contact SET deletedat = NOW(), updatedat = NOW() WHERE id = $1",
      [contactId]
    );

    res.json({ 
      success: true, 
      message: "Contact deleted successfully",
      deletedContactId: contactId
    });
  } catch (error: any) {
    console.error("❌ Delete Contact Error:", error.message);
    res.status(500).json({ error: "Failed to delete contact" });
  } finally {
    client.release();
  }
});

// 7️⃣ Delete all contacts
app.delete("/contacts", async (req: Request, res: Response) => {
  const { confirm } = req.query;

  // Require confirmation to prevent accidental deletion
  if (confirm !== "true") {
    return res.status(400).json({ 
      error: "Confirmation required. Add ?confirm=true to the URL to confirm deletion of all contacts." 
    });
  }

  const client = await pool.connect();
  try {
    // Soft delete all contacts
    const result = await client.query(
      "UPDATE contact SET deletedat = NOW(), updatedat = NOW() WHERE deletedat IS NULL"
    );

    res.json({ 
      success: true, 
      message: "All contacts deleted successfully",
      deletedCount: result.rowCount
    });
  } catch (error: any) {
    console.error("❌ Delete All Contacts Error:", error.message);
    res.status(500).json({ error: "Failed to delete all contacts" });
  } finally {
    client.release();
  }
});

// 8️⃣ Start server
app.listen(3000, () => {
  console.log("🚀 Server running at http://localhost:3000");
});
