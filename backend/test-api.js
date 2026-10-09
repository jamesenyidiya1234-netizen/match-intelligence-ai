require('dotenv').config();
const axios = require('axios');

async function testSportMonks() {
  console.log('--- STARTING SPORTMONKS API DIAGNOSTIC ---');
  
  const apiKey = process.env.SPORTMONKS_API_KEY;
  
  if (!apiKey || apiKey === 'YOUR_REAL_API_KEY_HERE') {
    console.error('❌ ERROR: Your SPORTMONKS_API_KEY is missing or not set in the .env file.');
    return;
  }
  
  console.log('✅ API Key found in .env file.');
  console.log('Attempting to connect to SportMonks...');

  try {
    // We will fetch just 2 matches to test
    const res = await axios.get(`https://api.sportmonks.com/v3/football/fixtures?api_token=${apiKey}&per_page=2`);
    
    console.log('\n✅ SUCCESS! HTTP Status:', res.status);
    console.log('SportMonks returned', res.data.data.length, 'matches.');
    
    if (res.data.data.length > 0) {
      console.log('\n--- SAMPLE MATCH DATA ---');
      console.log(JSON.stringify(res.data.data[0], null, 2));
      console.log('\n💡 CHECK: Does the match above have "home_team" and "away_team" names? If it says null, the API plan does not include team names.');
    } else {
      console.log('⚠️ WARNING: API connected successfully, but returned 0 matches.');
    }

  } catch (err) {
    console.error('\n❌ FAILED TO CONNECT TO API:');
    if (err.response) {
      // The request was made and the server responded with a status code outside of 2xx
      console.error('HTTP Status:', err.response.status);
      console.error('Error Message:', err.response.data.message);
      if (err.response.status === 401) console.error('-> Your API key is invalid or expired.');
      if (err.response.status === 403) console.error('-> Your API key is valid, but your plan does not support this endpoint.');
    } else {
      console.error('Network Error:', err.message);
    }
  }
  
  console.log('\n--- DIAGNOSTIC COMPLETE ---');
}

testSportMonks();