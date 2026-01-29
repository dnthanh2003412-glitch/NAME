// Trigger API refresh with detailed error
const url = 'http://127.0.0.1:3000/api/refresh';

console.log('Attempting to refresh:', url);

fetch(url, { method: 'POST' })
    .then(r => {
        console.log('Response status:', r.status);
        return r.json();
    })
    .then(data => {
        console.log('Success:', JSON.stringify(data, null, 2));
    })
    .catch(e => {
        console.error('Error:', e.message);
        console.error('Cause:', e.cause);
    });
