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
  
  // If it's a Supabase URL, try to force IPv4
  if (url.includes('supabase.co')) {
    try {
      // Parse the URL to extract components
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      
      // Try different approaches to force IPv4
      let newHostname = hostname;
      
      // Approach 1: Try with ipv4 prefix
      if (hostname.startsWith('db.')) {
        newHostname = hostname.replace('db.', 'db.ipv4.');
      }
      
      // Approach 2: If that doesn't work, try with explicit IPv4
      if (newHostname === hostname) {
        newHostname = hostname.replace('supabase.co', 'ipv4.supabase.co');
      }
      
      urlObj.hostname = newHostname;
      url = urlObj.toString();
      
      console.log("🔧 Modified DATABASE_URL for IPv4:", url);
    } catch (error) {
      console.error("❌ Error modifying DATABASE_URL:", error);
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
  ssl: { rejectUnauthorized: false },  // required by Supabase
  connectionTimeoutMillis: 10000, // 10 seconds
  idleTimeoutMillis: 30000, // 30 seconds
  max: 20, // maximum number of clients in the pool
});

// 3️⃣ Health check for DB
app.get("/testdb", async (req: Request, res: Response) => {
  console.log("🔍 Testing database connection...");
  console.log("📡 DATABASE_URL:", process.env.DATABASE_URL ? "Set" : "Not set");
  
  try {
    const client = await pool.connect();
    const result = await client.query("SELECT NOW()");
    client.release();
    console.log("✅ Database connection successful");
    res.json(result.rows);
  } catch (error: any) {
    console.error("❌ DB Test Error:", error.message);
    console.error("🔍 Error details:", error);
    res.status(500).json({ 
      error: "Database connection failed", 
      details: error.message,
      code: error.code 
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

// 6️⃣ Start server
app.listen(3000, () => {
  console.log("🚀 Server running at http://localhost:3000");
});
