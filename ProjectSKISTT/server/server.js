import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { createHash } from 'crypto'
import { google } from 'googleapis'
import { MongoClient, ObjectId } from 'mongodb'
import express from 'express'
import cors from 'cors'
import nodemailer from 'nodemailer'; // Use Nodemailer instead of SendGrid

// --- Google OAuth 2.0 Configuration ---
// IMPORTANT: Replace with your own credentials from Google Cloud Console
const GOOGLE_CLIENT_ID = '567055867533-cutlobhghu3l1bepecla3pvsrj4sojuk.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
const REDIRECT_URI = process.env.API_URL ? `${process.env.API_URL}/api/auth/google/callback` : 'http://localhost:3001/api/auth/google/callback';

console.log(`Using REDIRECT_URI: ${REDIRECT_URI}`);

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

// Initialize Express app
const app = express()
app.use(cors()) // Enable CORS for all routes
app.use(express.json({ limit: '25mb' }))

// --- MongoDB Connection ---
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('FATAL ERROR: MONGODB_URI environment variable is not set.');
  process.exit(1);
}

let db;
const client = new MongoClient(MONGODB_URI);

async function connectToMongo() {
  try {
    await client.connect();
    console.log('Successfully connected to MongoDB.');
    db = client.db(); // Use the default database from the connection string
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    process.exit(1);
  }
}

connectToMongo();

// --- Email Setup (Nodemailer) ---
const EMAIL_USER = process.env.EMAIL_USER; // Your Google email
const EMAIL_PASS = process.env.EMAIL_PASS; // Your Google App Password (fallback)
const EMAIL_REFRESH_TOKEN = process.env.EMAIL_REFRESH_TOKEN; // For OAuth2

let transporter;

if (EMAIL_USER && (EMAIL_REFRESH_TOKEN || EMAIL_PASS)) {
    const auth = EMAIL_REFRESH_TOKEN ? {
        type: 'OAuth2',
        user: EMAIL_USER,
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        refreshToken: EMAIL_REFRESH_TOKEN,
    } : {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
    };

    transporter = nodemailer.createTransport({
        service: 'gmail', // Automatically sets host to smtp.gmail.com and port 465/587 correctly
        auth: auth,
    });
    
    console.log(`Email configured for: ${EMAIL_USER} using ${EMAIL_REFRESH_TOKEN ? 'OAuth2' : 'App Password'}`);
} else {
    console.warn('EMAIL_USER and (EMAIL_PASS or EMAIL_REFRESH_TOKEN) are not set. Email sending will not work.');
}

// --- API Endpoints for the schedule ---

// GET email text
app.get('/api/email_text', async (req, res) => {
  const emailText = await db.collection('email_text').findOne({ id: 1 });
  res.json(emailText || { id: 1, text: '' });
});

// PUT (update) email text
app.put('/api/email_text/:id', async (req, res) => {
    try {
        const { text } = req.body;
        const result = await db.collection('email_text').updateOne(
            { id: 1 },
            { $set: { text: text } },
            { upsert: true }
        );
        res.json({ id: 1, text });
    } catch (error) {
        console.error('Error updating email text:', error);
        res.status(500).json({ message: 'Error updating email text' });
    }
});

// POST to send schedule email
app.post('/api/send-schedule', async (req, res) => {
    const { emailBody, recipient, subject, fileName, pdfDataUri } = req.body;

    console.log(`[POST /api/send-schedule] Attempting to send email to: ${recipient?.email}`);
    if (pdfDataUri) {
        console.log(`[POST /api/send-schedule] PDF Data URI length: ${pdfDataUri.length}`);
    } else {
        console.log(`[POST /api/send-schedule] WARNING: No PDF Data URI provided.`);
    }

    if (!transporter) {
        return res.status(503).json({ message: 'Email service is not configured. EMAIL_USER or EMAIL_PASS is missing.' });
    }
    if (!recipient || !recipient.email) {
        return res.status(400).json({ message: 'Recipient is not valid.' });
    }
    if (!pdfDataUri) {
        return res.status(400).json({ message: 'No PDF data provided.' });
    }

    try {
        const base64Data = pdfDataUri.split(';base64,').pop();

        const msg = {
            from: `"SKIS Schedule" <${EMAIL_USER}>`, // Sender address
            to: recipient.email,
            subject: subject,
            html: `<p>${emailBody.replace(/\n/g, '<br>')}</p>`, // Convert newlines to <br> for HTML email
            attachments: [
                {
                    content: base64Data,
                    filename: fileName,
                    contentType: 'application/pdf',
                    encoding: 'base64'
                },
            ],
        };

        await transporter.sendMail(msg);
        console.log(`Email sent to ${recipient.email} via Gmail SMTP.`);

        res.status(200).json({ message: `Email sent successfully to ${recipient.email}!` });

    } catch (error) {
        console.error(`Error sending schedule email to ${recipient.email}:`, error);
        res.status(500).json({ message: 'Failed to send email.', error: error.message });
    }
});



// GET all data (for simplicity, in a real app you'd paginate or filter)
app.get('/api/data', async (req, res) => {
  const schedules = await db.collection('schedules').find({}).toArray();
  const teachers = await db.collection('teachers').find({}).sort({ order: 1 }).toArray();
  const subjects = await db.collection('subjects').find({}).sort({ order: 1 }).toArray();
  const rooms = await db.collection('rooms').find({}).sort({ order: 1 }).toArray();
  const grades = (await db.collection('grades').findOne({}))?.values || [7, 8, 9, 10, 11, 12];
  res.json({ schedules, teachers, subjects, rooms, grades });
});





// POST a new event
app.post('/api/events', async (req, res) => {
  try {
    const newEvent = req.body;
    const { roomId, day, timeSlotId, grade, teacherId, force } = newEvent;

    // --- Comprehensive Conflict Validation ---
    if (!force && timeSlotId && (teacherId || roomId)) {
        const timeSlotEvents = await db.collection('schedules').find({
            day: day,
            timeSlotId: parseInt(timeSlotId, 10)
        }).toArray();

        for (const existingEvent of timeSlotEvents) {
            // Teacher conflict: same teacher, different room
            if (teacherId && existingEvent.teacherId === teacherId && existingEvent.roomId !== roomId) {
                return res.status(400).json({ message: 'This teacher is already scheduled in a different room at this time.' });
            }

            // Room conflict: same room, different teacher
            if (roomId && existingEvent.roomId === roomId && existingEvent.teacherId !== teacherId) {
                // Fetch teacher names for a more informative error message
                const newTeacherInfo = teacherId ? await db.collection('teachers').findOne({ _id: new ObjectId(teacherId) }) : { name: 'Another teacher' };
                const existingTeacherInfo = existingEvent.teacherId ? await db.collection('teachers').findOne({ _id: new ObjectId(existingEvent.teacherId) }) : { name: 'A teacher' };
                return res.status(400).json({ message: `Room is already booked by ${existingTeacherInfo?.name || 'a teacher'} at this time. Cannot schedule ${newTeacherInfo?.name || 'this lesson'}.` });
            }

            // Duplicate event conflict: same room, same teacher, same grade
            if (roomId && teacherId && existingEvent.roomId === roomId && existingEvent.teacherId === teacherId && existingEvent.grade === grade) {
                 return res.status(400).json({ message: 'This exact event (teacher, room, class) is already scheduled at this time.' });
            }
        }
    }
    
    // Ensure numeric types before saving
    if (newEvent.timeSlotId) newEvent.timeSlotId = parseInt(newEvent.timeSlotId, 10);
    if (newEvent.grade) newEvent.grade = parseInt(newEvent.grade, 10) || null; // Store as null if not a valid number
    if (newEvent.force !== undefined) delete newEvent.force; // Don't save the force flag to DB

    const result = await db.collection('schedules').insertOne(newEvent);
    res.status(201).json({ ...newEvent, _id: result.insertedId });
  } catch (error) {
    console.error('Error saving event:', error);
    res.status(500).json({ message: 'Error saving event' });
  }
});

// POST a batch of new events
app.post('/api/events/batch', async (req, res) => {
  try {
    const newEvents = req.body.map(event => {
      if (event.timeSlotId) event.timeSlotId = parseInt(event.timeSlotId, 10);
      if (event.grade) event.grade = parseInt(event.grade, 10) || null;
      return event;
    });

    if (!Array.isArray(newEvents)) {
      return res.status(400).json({ message: 'Request body must be an array of events.' });
    }

    const result = await db.collection('schedules').insertMany(newEvents);
    res.status(201).json(result.ops);
  } catch (error) {
    res.status(500).json({ message: 'Error saving batch of events' });
  }
});

// PUT (update) an event
app.put('/api/events/:id', async (req, res) => {
    try {
        const eventId = req.params.id;
        const updatedEvent = req.body;
        const { roomId, day, timeSlotId, grade, teacherId, force } = updatedEvent;

        // --- Comprehensive Conflict Validation ---
        if (!force && timeSlotId && (teacherId || roomId)) {
            const timeSlotEvents = await db.collection('schedules').find({
                _id: { $ne: new ObjectId(eventId) }, // Exclude the event being updated
                day: day,
                timeSlotId: parseInt(timeSlotId, 10)
            }).toArray();

            for (const existingEvent of timeSlotEvents) {
                // Teacher conflict: same teacher, different room
                if (teacherId && existingEvent.teacherId === teacherId && existingEvent.roomId !== roomId) {
                    return res.status(400).json({ message: 'This teacher is already scheduled in a different room at this time.' });
                }

                // Room conflict: same room, different teacher
                if (roomId && existingEvent.roomId === roomId && existingEvent.teacherId !== teacherId) {
                    // Fetch teacher names for a more informative error message
                    const newTeacherInfo = teacherId ? await db.collection('teachers').findOne({ _id: new ObjectId(teacherId) }) : { name: 'Another teacher' };
                    const existingTeacherInfo = existingEvent.teacherId ? await db.collection('teachers').findOne({ _id: new ObjectId(existingEvent.teacherId) }) : { name: 'A teacher' };
                    return res.status(400).json({ message: `Room is already booked by ${existingTeacherInfo?.name || 'a teacher'} at this time. Cannot schedule ${newTeacherInfo?.name || 'this lesson'}.` });
                }

                // Duplicate event conflict: same room, same teacher, same grade
                if (roomId && teacherId && existingEvent.roomId === roomId && existingEvent.teacherId === teacherId && existingEvent.grade === grade) {
                    return res.status(400).json({ message: 'This exact event (teacher, room, class) is already scheduled at this time.' });
                }
            }
        }
        
        const payload = { ...updatedEvent };
        // Ensure numeric types before saving
        if (payload.timeSlotId) payload.timeSlotId = parseInt(payload.timeSlotId, 10);
        if (payload.grade) payload.grade = parseInt(payload.grade, 10) || null;
        if (payload.force !== undefined) delete payload.force;
        
        // The frontend might send back the _id in the payload, which is immutable.
        // It's safer to remove it before the update operation.
        delete payload._id;

        const result = await db.collection('schedules').updateOne(
            { _id: new ObjectId(eventId) },
            { $set: payload }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ message: 'Event not found' });
        }

        res.json({ ...payload, _id: eventId });
    } catch (error) {
        console.error(`[PUT /api/events/${req.params.id}] Error updating event:`, error);
        res.status(500).json({ message: 'Error updating event' });
    }
});


// DELETE an event
app.delete('/api/events/:id', async (req, res) => {
    try {
        const eventId = req.params.id;
        const result = await db.collection('schedules').deleteOne({ _id: new ObjectId(eventId) });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Event not found' });
        }

        res.status(204).send(); // No Content
    } catch (error) {
        res.status(500).json({ message: 'Error deleting event' });
    }
});

// POST a new subject
app.post('/api/subjects', async (req, res) => {
  try {
    const { name, color, order } = req.body;
    if (!name || !color) {
      return res.status(400).json({ message: 'Name and color are required' });
    }
    const newSubject = { name, color, order };
    const result = await db.collection('subjects').insertOne(newSubject);
    res.status(201).json({ ...newSubject, _id: result.insertedId });
  } catch (error) {
    res.status(500).json({ message: 'Error saving subject' });
  }
});

// PUT (update) a subject
app.put('/api/subjects/:id', async (req, res) => {
  try {
    const subjectId = req.params.id;
    const { name, color, order } = req.body;
    const result = await db.collection('subjects').updateOne(
        { _id: new ObjectId(subjectId) },
        { $set: { name, color, order } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Subject not found' });
    }
    res.json({ _id: subjectId, name, color, order });
  } catch (error) {
    res.status(500).json({ message: 'Error updating subject' });
  }
});

// DELETE a subject
app.delete('/api/subjects/:id', async (req, res) => {
  try {
    const subjectId = req.params.id;

    // Check if the subject is in use
    const isInUse = await db.collection('schedules').findOne({ subjectId: subjectId });
    if (isInUse) {
      return res.status(400).json({ message: 'Cannot delete subject because it is currently in use in the schedule.' });
    }

    const result = await db.collection('subjects').deleteOne({ _id: new ObjectId(subjectId) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Subject not found' });
    }

    res.status(204).send(); // No Content
  } catch (error) {
    res.status(500).json({ message: 'Error deleting subject' });
  }
});

// --- Teacher Endpoints ---

// POST a new teacher
app.post('/api/teachers', async (req, res) => {
  try {
    const { name, order, email } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Name is required' });
    }
    const newTeacher = { name, order, email: email || '' };
    const result = await db.collection('teachers').insertOne(newTeacher);
    res.status(201).json({ ...newTeacher, _id: result.insertedId });
  } catch (error) {
    console.error('Error saving teacher:', error);
    res.status(500).json({ message: 'Error saving teacher' });
  }
});

// PUT (update) a teacher
app.put('/api/teachers/:id', async (req, res) => {
  try {
    const teacherId = req.params.id;
    const { name, order, email } = req.body;
    const result = await db.collection('teachers').updateOne(
        { _id: new ObjectId(teacherId) },
        { $set: { name, order, email } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Teacher not found' });
    }
    res.json({ _id: teacherId, name, order, email });
  } catch (error) {
    console.error('Error updating teacher:', error);
    res.status(500).json({ message: 'Error updating teacher' });
  }
});

// DELETE a teacher
app.delete('/api/teachers/:id', async (req, res) => {
  try {
    const teacherId = req.params.id;

    // Check if the teacher is in use
    const isInUse = await db.collection('schedules').findOne({ teacherId: teacherId });
    if (isInUse) {
      return res.status(400).json({ message: 'Cannot delete teacher because they are currently assigned to a schedule.' });
    }

    const result = await db.collection('teachers').deleteOne({ _id: new ObjectId(teacherId) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    res.status(204).send(); // No Content
  } catch (error) {
    console.error('Error deleting teacher:', error);
    res.status(500).json({ message: 'Error deleting teacher' });
  }
});

// --- Room Endpoints ---

// POST a new room
app.post('/api/rooms', async (req, res) => {
  try {
    const { name, order } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Name is required' });
    }
    const newRoom = { name, order };
    const result = await db.collection('rooms').insertOne(newRoom);
    res.status(201).json({ ...newRoom, _id: result.insertedId });
  } catch (error) {
    console.error('Error saving room:', error);
    res.status(500).json({ message: 'Error saving room' });
  }
});

// PUT (update) a room
app.put('/api/rooms/:id', async (req, res) => {
  try {
    const roomId = req.params.id;
    const { name, order } = req.body;
    const result = await db.collection('rooms').updateOne(
        { _id: new ObjectId(roomId) },
        { $set: { name, order } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Room not found' });
    }
    res.json({ _id: roomId, name, order });
  } catch (error) {
    console.error('Error updating room:', error);
    res.status(500).json({ message: 'Error updating room' });
  }
});

// DELETE a room
app.delete('/api/rooms/:id', async (req, res) => {
  try {
    const roomId = req.params.id;

    const isInUse = await db.collection('schedules').findOne({ roomId: roomId });
    if (isInUse) {
      return res.status(400).json({ message: 'Cannot delete room because it is currently in use in the schedule.' });
    }

    const result = await db.collection('rooms').deleteOne({ _id: new ObjectId(roomId) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Room not found' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting room:', error);
    res.status(500).json({ message: 'Error deleting room' });
  }
});


// DELETE schedule entries for a specific subject on a specific day
app.delete('/api/schedules/by-subject-and-day', async (req, res) => {
  try {
    const { subjectId, day } = req.body;
    if (!subjectId || !day) {
      return res.status(400).json({ message: 'subjectId and day are required' });
    }

    await db.collection('schedules').deleteMany({ subjectId: subjectId, day: day });
    res.status(200).json({ message: 'Schedule entries deleted successfully.' });
  } catch (error) {
    console.error('Error deleting schedule entries by subject and day:', error);
    res.status(500).json({ message: 'Error deleting schedule entries' });
  }
});

// DELETE schedule entries for a specific teacher on a specific day
app.delete('/api/schedules/by-teacher-and-day', async (req, res) => {
  try {
    const { teacherId, day } = req.body;
    if (!teacherId || !day) {
      return res.status(400).json({ message: 'teacherId and day are required' });
    }

    await db.collection('schedules').deleteMany({ teacherId: teacherId, day: day });
    res.status(200).json({ message: 'Schedule entries deleted successfully.' });
  } catch (error) {
    console.error('Error deleting schedule entries by teacher and day:', error);
    res.status(500).json({ message: 'Error deleting schedule entries' });
  }
});

// DELETE schedule entries for a specific room on a specific day
app.delete('/api/schedules/by-room-and-day', async (req, res) => {
  try {
    const { roomId, day } = req.body;
    if (!roomId || !day) {
      return res.status(400).json({ message: 'roomId and day are required' });
    }

    await db.collection('schedules').deleteMany({ roomId: roomId, day: day });
    res.status(200).json({ message: 'Schedule entries deleted successfully.' });
  } catch (error) {
    console.error('Error deleting schedule entries by room and day:', error);
    res.status(500).json({ message: 'Error deleting schedule entries' });
  }
});

// DELETE all schedule entries for a specific day
app.delete('/api/schedules/by-day', async (req, res) => {
  try {
    const { day } = req.body;
    if (!day) {
      return res.status(400).json({ message: 'Day is required' });
    }

    await db.collection('schedules').deleteMany({ day: day });
    res.status(200).json({ message: 'All schedule entries for the day were deleted successfully.' });
  } catch (error) {
    console.error('Error deleting schedule entries for day:', error);
    res.status(500).json({ message: 'Error deleting schedule entries for day' });
  }
});

// Endpoint to generate the Google Auth URL
app.get('/api/auth/google/url', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  });

  res.json({ url });
});

// Endpoint for Google OAuth callback
app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    console.log('--- GOOGLE AUTH CODE CAPTURED ---');
    console.log(code);
    console.log('---------------------------------');

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();

    const email = data.email;

    if (!email || !email.endsWith('@krumbach.school')) {
      // NOTE: You might want to create a dedicated error page on your frontend
      return res.redirect('${FRONTEND_URL}?error=Invalid%20domain');
    }

    const credentialsFilePath = join(__dirname, 'editor-credentials.txt');
    const credentialsData = fs.readFileSync(credentialsFilePath, 'utf8');
    const editors = new Map(credentialsData.split('\n').filter(Boolean).map(line => line.split(':')));

    const role = editors.has(email) ? 'editor' : 'viewer';

    const user = { email, role, name: data.name };

    // Redirect back to the frontend, passing the user object as a query parameter.
    // In a real production app, you would use a more secure method like JWTs and cookies.
    // The frontend URL is hardcoded here. You may need to change it depending on where you run your frontend.
    const userParam = encodeURIComponent(JSON.stringify(user));
    res.redirect(`${FRONTEND_URL}?user=${userParam}`);

  } catch (error) {
    console.error('Google Auth Callback Error:', error);
    res.redirect(`${FRONTEND_URL}?error=Authentication%20failed`);
  }
});

// --- Frontend Serving ---
// Serve static files from the client directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
app.use(express.static(join(__dirname, '../client')));

// Catch-all middleware to serve the frontend
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.sendFile(join(__dirname, '../client', 'index.html'));
  } else {
    next();
  }
});


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})