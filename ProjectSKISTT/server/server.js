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

const SUPER_ADMIN_EMAIL = 'a.bukhariev@krumbach.school';

async function connectToMongo() {
  try {
    await client.connect();
    console.log('Successfully connected to MongoDB.');
    db = client.db(); // Use the default database from the connection string
    await initializeUsers();
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    process.exit(1);
  }
}

async function initializeUsers() {
    try {
        const usersCount = await db.collection('users').countDocuments();
        if (usersCount === 0) {
            console.log('Initializing users from credentials file...');
            const credentialsFilePath = join(__dirname, 'editor-credentials.txt');
            if (fs.existsSync(credentialsFilePath)) {
                const credentialsData = fs.readFileSync(credentialsFilePath, 'utf8');
                const lines = credentialsData.split('\n').filter(Boolean);
                
                for (const line of lines) {
                    const [email, passwordHash] = line.split(':');
                    if (email) {
                        let role = 'editor';
                        if (email === SUPER_ADMIN_EMAIL) role = 'admin';
                        
                        // Check if user exists (should imply 0 count, but safe to check)
                        await db.collection('users').updateOne(
                            { email: email },
                            { $set: { email, role, passwordHash: passwordHash || '' } }, // passwordHash might be needed if we keep local auth logic anywhere, though we rely on Google mostly
                            { upsert: true }
                        );
                    }
                }
                console.log('Users initialized.');
            }
        }
        
        // Ensure Super Admin always exists and has admin role
        await db.collection('users').updateOne(
            { email: SUPER_ADMIN_EMAIL },
            { $set: { role: 'admin' } },
            { upsert: true }
        );
        
    } catch (err) {
        console.error('Error initializing users:', err);
    }
}

connectToMongo();

// --- SendGrid Setup ---
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_REFRESH_TOKEN = process.env.EMAIL_REFRESH_TOKEN;

let gmail;

if (EMAIL_USER && EMAIL_REFRESH_TOKEN) {
    const mailAuthClient = new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET
    );
    mailAuthClient.setCredentials({
        refresh_token: EMAIL_REFRESH_TOKEN
    });
    gmail = google.gmail({ version: 'v1', auth: mailAuthClient });
    console.log(`Email configured for: ${EMAIL_USER} using Gmail API`);
} else {
    console.warn('EMAIL_USER and EMAIL_REFRESH_TOKEN are not set. Email sending will not work.');
}

// Helper to encode message
const createMessage = (to, from, subject, message, attachmentName, attachmentData) => {
    const boundary = "foo_bar_baz";
    const nl = "\n";
    
    let str = "";
    str += "MIME-Version: 1.0" + nl;
    str += `To: ${to}` + nl;
    str += `From: ${from}` + nl;
    str += `Subject: ${subject}` + nl;
    str += `Content-Type: multipart/mixed; boundary="${boundary}"` + nl + nl;
    
    str += `--${boundary}` + nl;
    str += "Content-Type: text/html; charset=UTF-8" + nl;
    str += "Content-Transfer-Encoding: 7bit" + nl + nl;
    str += message + nl + nl;
    
    if (attachmentData) {
        str += `--${boundary}` + nl;
        str += `Content-Type: application/pdf; name="${attachmentName}"` + nl;
        str += `Content-Disposition: attachment; filename="${attachmentName}"` + nl;
        str += "Content-Transfer-Encoding: base64" + nl + nl;
        str += attachmentData + nl + nl;
    }
    
    str += `--${boundary}--`;
    
    // Base64url encode
    return Buffer.from(str).toString("base64").replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

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

    if (!gmail) {
        return res.status(503).json({ message: 'Email service is not configured. EMAIL_USER or EMAIL_REFRESH_TOKEN is missing.' });
    }
    if (!recipient || !recipient.email) {
        return res.status(400).json({ message: 'Recipient is not valid.' });
    }
    if (!pdfDataUri) {
        return res.status(400).json({ message: 'No PDF data provided.' });
    }

    try {
        const base64Data = pdfDataUri.split(';base64,').pop();
        const htmlBody = `<p>${emailBody.replace(/\n/g, '<br>')}</p>`;
        
        const rawMessage = createMessage(
            recipient.email,
            EMAIL_USER,
            subject,
            htmlBody,
            fileName,
            base64Data
        );

        await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: rawMessage
            }
        });

        console.log(`Email sent to ${recipient.email} via Gmail API.`);

        res.status(200).json({ message: `Email sent successfully to ${recipient.email}!` });

    } catch (error) {
        console.error(`Error sending schedule email to ${recipient.email}:`, error);
        res.status(500).json({ message: 'Failed to send email.', error: error.message });
    }
});



// GET config
app.get('/api/config', async (req, res) => {
  const config = await db.collection('config').findOne({ id: 1 });
  // Default config if not found
  const defaultConfig = { 
      id: 1, 
      allTeachersEmail: 'teachers@krumbach.school' 
  };
  res.json(config || defaultConfig);
});

// PUT config
app.put('/api/config', async (req, res) => {
    try {
        const { allTeachersEmail } = req.body;
        await db.collection('config').updateOne(
            { id: 1 },
            { $set: { allTeachersEmail } },
            { upsert: true }
        );
        res.json({ message: 'Config updated' });
    } catch (error) {
        console.error('Error updating config:', error);
        res.status(500).json({ message: 'Error updating config' });
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
    const { name, color, order, defaultTeacherId } = req.body;
    if (!name || !color) {
      return res.status(400).json({ message: 'Name and color are required' });
    }
    const newSubject = { name, color, order, defaultTeacherId: defaultTeacherId || null };
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
    const { name, color, order, defaultTeacherId } = req.body;
    const result = await db.collection('subjects').updateOne(
        { _id: new ObjectId(subjectId) },
        { $set: { name, color, order, defaultTeacherId: defaultTeacherId || null } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Subject not found' });
    }
    res.json({ _id: subjectId, name, color, order, defaultTeacherId: defaultTeacherId || null });
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
    const { name, order, email, defaultRoomId } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Name is required' });
    }
    const newTeacher = { name, order, email: email || '', defaultRoomId: defaultRoomId || null };
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
    const { name, order, email, defaultRoomId } = req.body;
    const result = await db.collection('teachers').updateOne(
        { _id: new ObjectId(teacherId) },
        { $set: { name, order, email, defaultRoomId: defaultRoomId || null } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Teacher not found' });
    }
    res.json({ _id: teacherId, name, order, email, defaultRoomId: defaultRoomId || null });
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

// --- User Management Endpoints ---

// GET all users (only for admin UI)
app.get('/api/users', async (req, res) => {
    // In a real app, verify admin session here.
    const users = await db.collection('users').find({}, { projection: { passwordHash: 0 } }).toArray(); // Exclude hash
    res.json(users);
});

// POST create new user (pre-register)
app.post('/api/users', async (req, res) => {
    try {
        const { email, name, role } = req.body;
        
        if (!email || !role) {
            return res.status(400).json({ message: 'Email and role are required' });
        }
        if (!['admin', 'editor', 'counter', 'viewer'].includes(role)) {
            return res.status(400).json({ message: 'Invalid role' });
        }

        const existingUser = await db.collection('users').findOne({ email: email });
        if (existingUser) {
            return res.status(409).json({ message: 'User already exists' });
        }

        const newUser = {
            email,
            name: name || '',
            role,
            createdAt: new Date(),
            preRegistered: true
        };

        const result = await db.collection('users').insertOne(newUser);
        res.status(201).json({ ...newUser, _id: result.insertedId });
    } catch (err) {
        console.error('Error creating user:', err);
        res.status(500).json({ message: 'Failed to create user' });
    }
});

// DELETE user
app.delete('/api/users/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const userToDelete = await db.collection('users').findOne({ _id: new ObjectId(userId) });
        
        if (!userToDelete) return res.status(404).json({ message: 'User not found' });
        if (userToDelete.email === SUPER_ADMIN_EMAIL) {
             return res.status(403).json({ message: 'Cannot delete Super Admin' });
        }

        await db.collection('users').deleteOne({ _id: new ObjectId(userId) });
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting user:', err);
        res.status(500).json({ message: 'Failed to delete user' });
    }
});

// PUT update user role
app.put('/api/users/:id/role', async (req, res) => {
    try {
        const userId = req.params.id;
        const { role } = req.body;
        
        // Validation
        if (!['admin', 'editor', 'counter', 'viewer'].includes(role)) {
            return res.status(400).json({ message: 'Invalid role' });
        }

        const userToUpdate = await db.collection('users').findOne({ _id: new ObjectId(userId) });
        
        if (!userToUpdate) return res.status(404).json({ message: 'User not found' });
        if (userToUpdate.email === SUPER_ADMIN_EMAIL && role !== 'admin') {
             return res.status(403).json({ message: 'Cannot demote Super Admin' });
        }

        await db.collection('users').updateOne(
            { _id: new ObjectId(userId) },
            { $set: { role: role } }
        );
        res.json({ message: 'Role updated' });
    } catch (err) {
        console.error('Error updating role:', err);
        res.status(500).json({ message: 'Failed to update role' });
    }
});

// Endpoint to generate the Google Auth URL
app.get('/api/auth/google/url', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/gmail.send' // Include Gmail scope we added
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
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();

    const email = data.email;

    if (!email || !email.endsWith('@krumbach.school')) {
      return res.redirect('${FRONTEND_URL}?error=Invalid%20domain');
    }

    // DB Role Lookup
    let user = await db.collection('users').findOne({ email: email });
    
    if (!user) {
        // Auto-register as viewer
        user = {
            email,
            role: 'viewer',
            name: data.name,
            createdAt: new Date()
        };
        const result = await db.collection('users').insertOne(user);
        user._id = result.insertedId;
    } else {
        // Update name if changed
        await db.collection('users').updateOne({ email: email }, { $set: { name: data.name } });
    }

    // Force Super Admin role in logic just in case
    if (email === SUPER_ADMIN_EMAIL) user.role = 'admin';

    const userParam = encodeURIComponent(JSON.stringify({ 
        email: user.email, 
        role: user.role, 
        name: user.name,
        _id: user._id
    }));
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