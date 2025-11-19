import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { createHash } from 'crypto'
import { google } from 'googleapis'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import express from 'express'
import cors from 'cors'
import nodemailer from 'nodemailer';

// --- Google OAuth 2.0 Configuration ---
// IMPORTANT: Replace with your own credentials from Google Cloud Console
const GOOGLE_CLIENT_ID = '567055867533-cutlobhghu3l1bepecla3pvsrj4sojuk.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
// This should match the authorized redirect URI in your Google Cloud project
const REDIRECT_URI = 'http://localhost:3001/api/auth/google/callback';

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

// Initialize Express app
const app = express()
app.use(cors()) // Enable CORS for all routes
app.use(express.json({ limit: '50mb' }))

// Initialize lowdb database
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const file = join(__dirname, 'db.json')
const adapter = new JSONFile(file)

// Set default data and initialize db
const defaultData = {
  schedules: [],
  teachers: [
    { id: 'CW', name: 'CW' }, { id: 'TS', name: 'TS' }, { id: 'VV', name: 'VV' }, 
    { id: 'SQ', name: 'SQ' }, { id: 'CH', name: 'CH' }, { id: 'EB', name: 'EB' }, 
    { id: 'MM', name: 'MM' }, { id: 'ES', name: 'ES' }, { id: 'AA', name: 'AA' }, 
    { id: 'AT', name: 'AT' }, { id: 'EP', name: 'EP' }, { id: 'LV', name: 'LV' }, 
    { id: 'NPB', name: 'NPB' }, { id: 'TG', name: 'TG' }, { id: 'EK', name: 'EK' }
  ],
  subjects: [
    { id: 1, name: 'History', color: '#c8e6c9' },
    { id: 2, name: 'English', color: '#d7eaf3' },
    { id: 3, name: 'Mathematics', color: '#ffcdd2' },
    { id: 4, name: 'Biology', color: '#dcedc8' },
    { id: 5, name: 'Chemistry', color: '#fce4ec' },
    { id: 6, name: 'German', color: '#ffe0b2' },
    { id: 7, name: 'Russian', color: '#fff9c4' },
    { id: 8, name: 'Sport', color: '#ffccbc' },
    { id: 9, name: 'Homework', color: '#d6dde1' },
    { id: 10, name: 'Persian', color: '#ffe0b2' },
    { id: 11, name: 'Russian Literature', color: '#e0d1dc' },
    { id: 12, name: 'CAS', color: '#b2dfdb' },
    { id: 13, name: 'Physics', color: '#d1d4f0' },
    { id: 14, name: 'Art', color: '#d7ccc8' },
    { id: 15, name: 'Music', color: '#f0f4c3' },
    { id: 16, name: 'Singing', color: '#fff9c4' },
    { id: 17, name: 'TOK', color: '#b2ebf2' },
    { id: 18, name: 'ESS', color: '#f5f5f5' }
  ],
  rooms: [
    { id: 1, name: 'room 1.1' }, { id: 2, name: 'room 1.2' }, { id: 3, name: 'room 1.3' }, 
    { id: 4, name: 'room 1.4' }, { id: 5, name: 'room 1.5' }, { id: 6, name: 'room 1.6' }, 
    { id: 7, name: 'room 1.7' }, { id: 8, name: 'Lab 1' }, { id: 9, name: 'Lab 4' }, 
    { id: 10, name: 'Artroom' }, { id: 11, name: 'library online' }
  ],
  grades: [7, 8, 9, 10, 11, 12]
}

const db = new Low(adapter, defaultData)

try {
  await db.read()

  // --- Data Migrations ---
  // Simple migration to add 'order' to teachers and rooms if it doesn't exist
  let needsWrite = false;
  if (db.data.teachers.some(t => t.order === undefined)) {
    console.log('Running migration: Adding "order" field to teachers...');
    db.data.teachers.forEach((teacher, index) => {
      if (teacher.order === undefined) {
        teacher.order = index;
      }
    });
    needsWrite = true;
  }
  if (db.data.rooms.some(r => r.order === undefined)) {
    console.log('Running migration: Adding "order" field to rooms...');
    db.data.rooms.forEach((room, index) => {
      if (room.order === undefined) {
        room.order = index;
      }
    });
    needsWrite = true;
  }

  if (needsWrite) {
    await db.write();
    console.log('Migration complete. Database updated.');
  }
} catch (error) {
  console.error('Error during database initialization or migration:', error);
  process.exit(1);
}



// Nodemailer setup for testing with Ethereal
// This will create a test account and log the credentials to the console
// and open a preview URL to see the sent email.
let transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // Use `true` for port 465, `false` for other ports like 587
    auth: {
        user: "schedule@krumbach.school",
        pass: "rxua ohxn nibl tapy"
    }
});



// --- API Endpoints for the schedule ---

// GET email text
app.get('/api/email_text', async (req, res) => {
  await db.read();
  res.json(db.data.email_text[0] || { id: 1, text: '' });
});

// PUT (update) email text
app.put('/api/email_text/:id', async (req, res) => {
    try {
        const { text } = req.body;
        const emailText = db.data.email_text[0];

        if (!emailText) {
            // This case is unlikely if db.json is set up correctly
            db.data.email_text[0] = { id: 1, text: text };
        } else {
            emailText.text = text;
        }

        await db.write();
        res.json(emailText);
    } catch (error) {
        console.error('Error updating email text:', error);
        res.status(500).json({ message: 'Error updating email text' });
    }
});

// POST to send schedule email
app.post('/api/send-schedule', express.json({ limit: '50mb' }), async (req, res) => {
    const { emailBody, recipient, subject, fileName, pdfDataUri } = req.body;

    if (!transporter) {
        return res.status(503).json({ message: 'Email service is not ready yet.' });
    }
    if (!recipient || !recipient.email) {
        return res.status(400).json({ message: 'Recipient is not valid.' });
    }
    if (!pdfDataUri) {
        return res.status(400).json({ message: 'No PDF data provided.' });
    }

    try {
        // The data URI has a prefix like "data:application/pdf;base64," which we need to remove.
        const base64Data = pdfDataUri.split(';base64,').pop();

        const mailOptions = {
            from: '"SKIS Schedule" <schedule@krumbach.school>',
            to: recipient.email,
            subject: subject,
            text: emailBody,
            attachments: [{
                filename: fileName,
                content: base64Data,
                encoding: 'base64',
                contentType: 'application/pdf'
            }]
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`Message sent to ${recipient.email}: %s`, info.messageId);
        // For Gmail, there's no direct preview URL like with Ethereal.
        // You'll need to check the actual inbox.

        res.status(200).json({ message: `Email sent successfully to ${recipient.email}!` });

    } catch (error) {
        console.error(`Error sending schedule email to ${recipient.email}:`, error);
        res.status(500).json({ message: 'Failed to send email.', error: error.message });
    }
});



// GET all data (for simplicity, in a real app you'd paginate or filter)
app.get('/api/data', async (req, res) => {
  await db.read()
  res.json(db.data)
});

// POST a new event
app.post('/api/events', async (req, res) => {
  try {
    const newEvent = req.body;
    newEvent.id = Date.now(); // Simple unique ID
    db.data.schedules.push(newEvent);
    await db.write();
    res.status(201).json(newEvent);
  } catch (error) {
    res.status(500).json({ message: 'Error saving event' });
  }
});

// POST a batch of new events
app.post('/api/events/batch', async (req, res) => {
  try {
    const newEvents = req.body; // Expecting an array of events
    if (!Array.isArray(newEvents)) {
      return res.status(400).json({ message: 'Request body must be an array of events.' });
    }

    const createdEvents = [];
    newEvents.forEach((event, index) => {
      const newEventWithId = { ...event };
      newEventWithId.id = Date.now() + index; // Simple unique ID for batch
      db.data.schedules.push(newEventWithId);
      createdEvents.push(newEventWithId);
    });

    await db.write();
    res.status(201).json(createdEvents);
  } catch (error) {
    res.status(500).json({ message: 'Error saving batch of events' });
  }
});

// PUT (update) an event
app.put('/api/events/:id', async (req, res) => {
    try {
        const eventId = parseInt(req.params.id, 10);
        const eventIndex = db.data.schedules.findIndex(e => e.id === eventId);

        if (eventIndex === -1) {
            return res.status(404).json({ message: 'Event not found' });
        }

        db.data.schedules[eventIndex] = { ...db.data.schedules[eventIndex], ...req.body };
        await db.write();
        res.json(db.data.schedules[eventIndex]);
    } catch (error) {
        res.status(500).json({ message: 'Error updating event' });
    }
});


// DELETE an event
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

// POST a new subject
app.post('/api/subjects', async (req, res) => {
  try {
    const { name, color, order } = req.body;
    if (!name || !color) {
      return res.status(400).json({ message: 'Name and color are required' });
    }
    const newId = Math.max(0, ...db.data.subjects.map(s => s.id)) + 1;
    const newSubject = { id: newId, name, color, order: order !== undefined ? order : newId };
    db.data.subjects.push(newSubject);
    await db.write();
    res.status(201).json(newSubject);
  } catch (error) {
    res.status(500).json({ message: 'Error saving subject' });
  }
});

// PUT (update) a subject
app.put('/api/subjects/:id', async (req, res) => {
  try {
    const subjectId = parseInt(req.params.id, 10);
    const { name, color, order } = req.body;
    const subjectIndex = db.data.subjects.findIndex(s => s.id === subjectId);

    if (subjectIndex === -1) {
      return res.status(404).json({ message: 'Subject not found' });
    }
    if (name) db.data.subjects[subjectIndex].name = name;
    if (color) db.data.subjects[subjectIndex].color = color;
    if (order !== undefined) db.data.subjects[subjectIndex].order = order;

    await db.write();
    res.json(db.data.subjects[subjectIndex]);
  } catch (error) {
    res.status(500).json({ message: 'Error updating subject' });
  }
});

// DELETE a subject
app.delete('/api/subjects/:id', async (req, res) => {
  try {
    const subjectId = parseInt(req.params.id, 10);

    // Check if the subject is in use
    const isInUse = db.data.schedules.some(schedule => schedule.subjectId === subjectId);
    if (isInUse) {
      return res.status(400).json({ message: 'Cannot delete subject because it is currently in use in the schedule.' });
    }

    const initialLength = db.data.subjects.length;
    db.data.subjects = db.data.subjects.filter(s => s.id !== subjectId);

    if (db.data.subjects.length === initialLength) {
      return res.status(404).json({ message: 'Subject not found' });
    }

    await db.write();
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
    // A simple way to generate a new ID, suitable for this app's scale
    const newId = name.replace(/\s+/g, '').toUpperCase() + Date.now().toString().slice(-4);
    const newTeacher = { id: newId, name, order: order !== undefined ? order : db.data.teachers.length, email: email || '' };
    db.data.teachers.push(newTeacher);
    await db.write();
    res.status(201).json(newTeacher);
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
    const teacherIndex = db.data.teachers.findIndex(t => t.id === teacherId);

    if (teacherIndex === -1) {
      return res.status(404).json({ message: 'Teacher not found' });
    }
    if (name) db.data.teachers[teacherIndex].name = name;
    if (order !== undefined) db.data.teachers[teacherIndex].order = order;
    if (email !== undefined) db.data.teachers[teacherIndex].email = email;

    await db.write();
    res.json(db.data.teachers[teacherIndex]);
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
    const isInUse = db.data.schedules.some(schedule => schedule.teacherId === teacherId);
    if (isInUse) {
      return res.status(400).json({ message: 'Cannot delete teacher because they are currently assigned to a schedule.' });
    }

    const initialLength = db.data.teachers.length;
    db.data.teachers = db.data.teachers.filter(t => t.id !== teacherId);

    if (db.data.teachers.length === initialLength) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    await db.write();
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
    const newId = Math.max(0, ...db.data.rooms.map(r => r.id)) + 1;
    const newRoom = { id: newId, name, order: order !== undefined ? order : db.data.rooms.length };
    db.data.rooms.push(newRoom);
    await db.write();
    res.status(201).json(newRoom);
  } catch (error) {
    console.error('Error saving room:', error);
    res.status(500).json({ message: 'Error saving room' });
  }
});

// PUT (update) a room
app.put('/api/rooms/:id', async (req, res) => {
  try {
    const roomId = parseInt(req.params.id, 10);
    const { name, order } = req.body;
    const roomIndex = db.data.rooms.findIndex(r => r.id === roomId);

    if (roomIndex === -1) {
      return res.status(404).json({ message: 'Room not found' });
    }
    if (name) db.data.rooms[roomIndex].name = name;
    if (order !== undefined) db.data.rooms[roomIndex].order = order;

    await db.write();
    res.json(db.data.rooms[roomIndex]);
  } catch (error) {
    console.error('Error updating room:', error);
    res.status(500).json({ message: 'Error updating room' });
  }
});

// DELETE a room
app.delete('/api/rooms/:id', async (req, res) => {
  try {
    const roomId = parseInt(req.params.id, 10);

    const isInUse = db.data.schedules.some(schedule => schedule.roomId === roomId);
    if (isInUse) {
      return res.status(400).json({ message: 'Cannot delete room because it is currently in use in the schedule.' });
    }

    const initialLength = db.data.rooms.length;
    db.data.rooms = db.data.rooms.filter(r => r.id !== roomId);

    if (db.data.rooms.length === initialLength) {
      return res.status(404).json({ message: 'Room not found' });
    }

    await db.write();
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

    const initialLength = db.data.schedules.length;
    db.data.schedules = db.data.schedules.filter(event => {
      // Keep the event if it does NOT match the subjectId and day to be deleted
      return !(event.subjectId === subjectId && event.day === day);
    });

    if (db.data.schedules.length === initialLength) {
      // This isn't necessarily an error, could just mean no entries were found to delete
      return res.status(200).json({ message: 'No matching schedule entries found to delete.' });
    }

    await db.write();
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

    const initialLength = db.data.schedules.length;
    db.data.schedules = db.data.schedules.filter(event => {
      // Keep the event if it does NOT match the teacherId and day to be deleted
      return !(event.teacherId === teacherId && event.day === day);
    });

    if (db.data.schedules.length === initialLength) {
      return res.status(200).json({ message: 'No matching schedule entries found to delete.' });
    }

    await db.write();
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

    const initialLength = db.data.schedules.length;
    db.data.schedules = db.data.schedules.filter(event => {
      return !(event.roomId === roomId && event.day === day);
    });

    if (db.data.schedules.length === initialLength) {
      return res.status(200).json({ message: 'No matching schedule entries found to delete.' });
    }

    await db.write();
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

    const initialLength = db.data.schedules.length;
    db.data.schedules = db.data.schedules.filter(event => event.day !== day);

    if (db.data.schedules.length === initialLength) {
      return res.status(200).json({ message: 'No matching schedule entries found to delete for the specified day.' });
    }

    await db.write();
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
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();

    const email = data.email;

    if (!email || !email.endsWith('@krumbach.school')) {
      // NOTE: You might want to create a dedicated error page on your frontend
      return res.redirect('http://localhost:8080?error=Invalid%20domain');
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
    res.redirect(`http://localhost:8080?user=${userParam}`);

  } catch (error) {
    console.error('Google Auth Callback Error:', error);
    res.redirect('http://localhost:8080?error=Authentication%20failed');
  }
});


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})