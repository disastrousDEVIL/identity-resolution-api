CREATE TABLE Contact(id SERIAL PRIMARY KEY, phoneNumber VARCHAR(20), emailVARCHAR(255),linkedId INT, linkPrecedence VARCHAR(20) CHECK (linkPrecedence IN ('primary','secondary')), createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deletedAt TIMESTAMP);
