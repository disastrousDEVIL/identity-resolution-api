CREATE TABLE contact(
  id SERIAL PRIMARY KEY, 
  phonenumber VARCHAR(20), 
  email VARCHAR(255),
  linkedid INT, 
  linkprecedence VARCHAR(20) CHECK (linkprecedence IN ('primary','secondary')), 
  createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deletedat TIMESTAMP,
  FOREIGN KEY (linkedid) REFERENCES contact(id)
);
