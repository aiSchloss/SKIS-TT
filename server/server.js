import { join, dirname } from 'path'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'

// Get __dirname in ES module
const __dirname = dirname(fileURLToPath(import.meta.url))

// Use JSON file for storage
const file = join(__dirname, 'db.json')
const adapter = new JSONFile(file)
const db = new Low(adapter)

// Read data from JSON file, this will set db.data content
await db.read()

// Set default data if db.json is empty
db.data = db.data || { schedules: [], teachers: [], subjects: [], rooms: [], grades: [] }

// Initialize Express app
const app = express()
const corsOptions = {
  origin: '*', // Allow all origins
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  preflightContinue: false,
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));
app.use(express.json())

// API Routes
app.get('/api/data', (req, res) => {
  res.json(db.data)
})

app.post('/api/events', async (req, res) => {
  const newEvent = { id: Date.now(), ...req.body }
  db.data.schedules.push(newEvent)
  await db.write()
  res.status(201).json(newEvent)
})

app.put('/api/events/:id', async (req, res) => {
  const eventId = parseInt(req.params.id)
  const eventIndex = db.data.schedules.findIndex(e => e.id === eventId)

  if (eventIndex > -1) {
    db.data.schedules[eventIndex] = { ...db.data.schedules[eventIndex], ...req.body }
    await db.write()
    res.json(db.data.schedules[eventIndex])
  } else {
    res.status(404).json({ message: 'Event not found' })
  }
})

app.delete('/api/events/:id', async (req, res) => {
    try {
        const eventId = parseInt(req.params.id, 10);
        const initialLength = db.data.schedules.length;
        db.data.schedules = db.data.schedules.filter(e => e.id !== eventId);

        if (db.data.schedules.length === initialLength) {
            return res.status(404).json({ message: 'Event not found' });
        }

        await db.write();
        res.status(204).send(); // No Content
    } catch (error) {
        res.status(500).json({ message: 'Error deleting event' });
    }
});

app.post('/api/events/batch', async (req, res) => {
  const newEvents = req.body.map(event => ({ id: Date.now() + Math.random(), ...event }));
  db.data.schedules.push(...newEvents);
  await db.write();
  res.status(201).json(newEvents);
});

// Subject API routes
app.post('/api/subjects', async (req, res) => {
  const newSubject = { id: Date.now(), ...req.body };
  db.data.subjects.push(newSubject);
  await db.write();
  res.status(201).json(newSubject);
});

app.put('/api/subjects/:id', async (req, res) => {
  const subjectId = parseInt(req.params.id);
  const subjectIndex = db.data.subjects.findIndex(s => s.id === subjectId);

  if (subjectIndex > -1) {
    db.data.subjects[subjectIndex] = { ...db.data.subjects[subjectIndex], ...req.body };
    await db.write();
    res.json(db.data.subjects[subjectIndex]);
  } else {
    res.status(404).json({ message: 'Subject not found' });
  }
});

// Static file serving should be after API routes
app.use(express.static('../client'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
