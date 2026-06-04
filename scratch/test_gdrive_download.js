import fetch from 'node-fetch'; // Wait, let's use native fetch (available in Node.js 18+)

const fileId = '1rqN6qiR7lhAxsDpOj-8nMPNHYuhObySQ';

async function run() {
  const url = `https://docs.google.com/uc?export=download&id=${fileId}`;
  console.log('1. Fetching warning page:', url);
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  const res = await fetch(url, { headers });
  console.log('Initial Response Status:', res.status);
  console.log('Initial Response Headers:', Object.fromEntries(res.headers.entries()));

  const html = await res.text();
  console.log('HTML Length:', html.length);

  // Parse form parameters
  const confirmMatch = html.match(/name="confirm"\s+value="([^"]+)"/);
  const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/);
  
  console.log('confirmMatch:', confirmMatch ? confirmMatch[1] : 'null');
  console.log('uuidMatch:', uuidMatch ? uuidMatch[1] : 'null');

  if (!confirmMatch || !uuidMatch) {
    console.log('Not a warning page, or parameters not found.');
    return;
  }

  // Get NID cookie
  const setCookie = res.headers.get('set-cookie');
  console.log('set-cookie:', setCookie);

  const confirmUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmMatch[1]}&uuid=${uuidMatch[1]}`;
  console.log('2. Requesting confirmation URL:', confirmUrl);

  const confirmHeaders = {
    'User-Agent': headers['User-Agent'],
    'Cookie': setCookie ? setCookie.split(';')[0] : ''
  };

  const finalRes = await fetch(confirmUrl, {
    method: 'GET',
    headers: confirmHeaders,
    redirect: 'manual' // We want to see if it redirects or streams
  });

  console.log('Final Response Status:', finalRes.status);
  console.log('Final Response Headers:', Object.fromEntries(finalRes.headers.entries()));
  
  const finalHtml = await finalRes.text();
  console.log('\nFinal HTML Body:\n', finalHtml);
}

run().catch(err => console.error(err));
