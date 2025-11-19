
import { createHash } from 'crypto';

const password = process.argv[2];

if (!password) {
  console.error('Usage: node hash-password.js <password>');
  process.exit(1);
}

const hash = createHash('sha256').update(password).digest('hex');
console.log(hash);
