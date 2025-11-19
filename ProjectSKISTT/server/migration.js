import { MongoClient } from 'mongodb';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
const MONGODB_URI = process.env.MONGODB_URI;
const JSON_FILE_PATH = path.join(__dirname, 'db.json');

async function migrate() {
  if (!MONGODB_URI) {
    console.error('FATAL ERROR: MONGODB_URI environment variable is not set.');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    // --- 1. Connect to MongoDB ---
    await client.connect();
    const db = client.db();
    console.log('Successfully connected to MongoDB for migration.');

    // --- 2. Read data from db.json ---
    console.log(`Reading data from ${JSON_FILE_PATH}...`);
    const fileContent = await fs.readFile(JSON_FILE_PATH, 'utf-8');
    const data = JSON.parse(fileContent);

    // --- 3. Define collections and data to migrate ---
    const collectionsToMigrate = {
      teachers: data.teachers || [],
      subjects: data.subjects || [],
      rooms: data.rooms || [],
      schedules: data.schedules || [],
      grades: [{ values: data.grades || [7, 8, 9, 10, 11, 12] }],
      email_text: data.email_text || [{ id: 1, text: '' }],
    };

    // --- 4. Perform migration ---
    for (const [collectionName, documents] of Object.entries(collectionsToMigrate)) {
      if (documents.length === 0) {
        console.log(`Skipping collection '${collectionName}' as it has no data.`);
        continue;
      }

      console.log(`Migrating collection: '${collectionName}'...`);
      const collection = db.collection(collectionName);

      // Clear existing data in the collection
      await collection.deleteMany({});
      console.log(`  - Cleared existing documents in '${collectionName}'.`);

      // Insert new data
      await collection.insertMany(documents);
      console.log(`  - Inserted ${documents.length} documents into '${collectionName}'.`);
    }

    console.log('\nMigration completed successfully! 🎉');

  } catch (error) {
    console.error('\nAn error occurred during migration:');
    console.error(error);
    process.exit(1);
  } finally {
    // --- 5. Close connection ---
    await client.close();
    console.log('MongoDB connection closed.');
  }
}

migrate();
