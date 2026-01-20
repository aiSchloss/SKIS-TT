import { google } from 'googleapis';
import readline from 'readline';

// REPLACE THESE WITH YOUR CREDENTIALS FROM server.js
const GOOGLE_CLIENT_ID = '567055867533-cutlobhghu3l1bepecla3pvsrj4sojuk.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
// Back to production URI
const REDIRECT_URI = 'https://school-schedule-app.onrender.com/api/auth/google/callback'; 

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = ['https://mail.google.com/'];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent' // Forces a new refresh token to be issued
});

console.log('1. Open this URL in your browser:\n', authUrl);
console.log('\n2. Authorize the app.');
console.log('3. You will be redirected to your website (it might show an error, ignore it).');
console.log('4. COPY the "code" parameter from the URL address bar.');
console.log('   Example: https://.../callback?code=4/0A...&scope=...');
console.log('   (Copy only the part between "code=" and "&")');

rl.question('\nPaste the code here: ', async (code) => {
  try {
    // Decode if user pasted encoded URL characters
    const decodedCode = decodeURIComponent(code);
    const { tokens } = await oauth2Client.getToken(decodedCode);
    console.log('\nSuccess! Here is your Refresh Token (save this to Render env vars as EMAIL_REFRESH_TOKEN):');
    console.log(tokens.refresh_token);
    console.log('\nAccess Token (temporary):', tokens.access_token);
  } catch (err) {
    console.error('Error retrieving access token', err);
  }
  rl.close();
});
