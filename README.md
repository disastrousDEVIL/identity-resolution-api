# 🛠 Identity Resolution API

A backend service that reconciles customer identities across multiple purchases using **email** and **phone number**.

Built with **Node.js (TypeScript), Express, PostgreSQL (Supabase on Render)**.

Live API deployed on Render →
👉 **[https://identity-resolution-api.onrender.com](https://identity-resolution-api.onrender.com)**

---

## 📖 Problem Statement

FluxKart customers sometimes use different combinations of **email** and **phone number** across orders.
This makes it hard to identify them as the same person.

The **Identity Resolution API** solves this by:

* Linking contacts that share either email or phone number.
* Assigning the **oldest record as primary**, others as **secondary**.
* Returning a consolidated view of the customer.

---

## 📦 Tech Stack

* **Backend:** Node.js, Express, TypeScript
* **Database:** PostgreSQL (Supabase)
* **Hosting:** Render
* **ORM:** Raw SQL queries via `pg`

---

## 🔑 API Endpoints

### 1. Health Check (DB Test)

**GET** `/testdb`

Confirms if the API can connect to Supabase.

**Response:**

```json
{
  "success": true,
  "data": {
    "current_time": "2025-08-23T08:11:32.123Z",
    "pg_version": "PostgreSQL 15.5 ..."
  },
  "message": "Database connection successful"
}
```

---

### 2. Identity Resolution

**POST** `/identify`

Main endpoint for creating/merging customer contacts.

**Request Example:**

```json
{
  "email": "mcfly@hillvalley.edu",
  "phoneNumber": "123456"
}
```

**Response Example:**

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["lorraine@hillvalley.edu", "mcfly@hillvalley.edu"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [2]
  }
}
```

✅ Logic:

* If no match → creates a new **primary contact**.
* If overlap with new info → inserts a **secondary contact**.
* If multiple primaries exist → merges into the oldest primary.

---

### 3. Get All Contacts (Debugging)

**GET** `/contacts`

Fetches all contacts from DB (excluding deleted ones).

**Response Example:**

```json
[
  {
    "id": 1,
    "phonenumber": "123456",
    "email": "lorraine@hillvalley.edu",
    "linkedid": null,
    "linkprecedence": "primary",
    "createdat": "...",
    "updatedat": "...",
    "deletedat": null
  },
  {
    "id": 2,
    "phonenumber": "123456",
    "email": "mcfly@hillvalley.edu",
    "linkedid": 1,
    "linkprecedence": "secondary",
    "createdat": "...",
    "updatedat": "...",
    "deletedat": null
  }
]
```

---

### 4. Delete a Specific Contact

**DELETE** `/contacts/:id`

Soft deletes a single contact by ID.

* If primary → also deletes all linked secondary contacts.
* If secondary → only deletes that entry.

**Response Example:**

```json
{
  "success": true,
  "message": "Contact deleted successfully",
  "deletedContactId": 2
}
```

---

### 5. Delete All Contacts

**DELETE** `/contacts?confirm=true`

Soft deletes **all contacts** in the DB.
⚠️ Requires query param `confirm=true` to avoid accidental mass deletion.

**Response Example:**

```json
{
  "success": true,
  "message": "All contacts deleted successfully",
  "deletedCount": 5
}
```

---

## 🗄 Database Schema

```sql
CREATE TABLE IF NOT EXISTS contact (
    id SERIAL PRIMARY KEY,
    phoneNumber VARCHAR(20),
    email VARCHAR(255),
    linkedId INT REFERENCES contact(id),
    linkPrecedence VARCHAR(20) CHECK (linkPrecedence IN ('primary', 'secondary')),
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deletedAt TIMESTAMP
);
```

---

## 🚀 Running Locally

1. Clone the repo:

   ```bash
   git clone https://github.com/disastrousDEVIL/identity-resolution-api.git
   cd identity-resolution-api
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Setup `.env`:

   ```env
   DATABASE_URL=postgresql://postgres:<PASSWORD>@localhost:5432/bitespeed?sslmode=require
   ```

4. Start in dev mode:

   ```bash
   npm run dev
   ```

---

## 🌍 Deployment

* **Backend:** Render
* **Database:** Supabase (Session Pooler + SSL enabled)
* Live API: [https://identity-resolution-api.onrender.com](https://identity-resolution-api.onrender.com)

---

## 🧪 Usage Examples

### Create Primary Contact

```powershell
Invoke-RestMethod -Uri "https://identity-resolution-api.onrender.com/identify" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"email":"alice@example.com","phoneNumber":"555111"}' | ConvertTo-Json -Depth 10
```

### Add Secondary Contact

```powershell
Invoke-RestMethod -Uri "https://identity-resolution-api.onrender.com/identify" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"email":"bob@example.com","phoneNumber":"555111"}' | ConvertTo-Json -Depth 10
```

### List All Contacts

```powershell
Invoke-RestMethod -Uri "https://identity-resolution-api.onrender.com/contacts" -Method Get | ConvertTo-Json -Depth 10
```

### Delete Contact by ID

```powershell
Invoke-RestMethod -Uri "https://identity-resolution-api.onrender.com/contacts/1" -Method Delete | ConvertTo-Json -Depth 10
```

### Delete All Contacts

```powershell
Invoke-RestMethod -Uri "https://identity-resolution-api.onrender.com/contacts?confirm=true" -Method Delete | ConvertTo-Json -Depth 10
```

---

## ✅ Submission

* **GitHub Repo:** [https://github.com/disastrousDEVIL/identity-resolution-api](https://github.com/disastrousDEVIL/identity-resolution-api)
* **Live Endpoint:** [https://identity-resolution-api.onrender.com/identify](https://identity-resolution-api.onrender.com/identify)

---

✨ This project fulfills the Bitespeed Backend Task for Identity Reconciliation.

---

Would you like me to also add a **sequence diagram (image)** in the README (showing primary/secondary merge logic), or keep it text-only?
