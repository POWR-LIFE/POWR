const { execSync } = require('child_process');
const { parse } = require('node-html-parser');

// Read env vars
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wjvvujnicwkruaeibttt.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is missing! Cannot proceed without it.');
  process.exit(1);
}

// Fetch all gyms
const fetchGyms = async () => {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/partners?category=eq.gym`, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    const data = await res.json();
    console.log('Fetched gyms:', data.count || 0);
    return data.data || [];
  } catch (err) {
    console.error('Fetch error:', err);
    process.exit(1);
  }
};

// Update gym locations
const updateGymLocations = async (gyms) => {
  let updated = 0, unchanged = 0, failed = 0;
  for (const gym of gyms) {
    const locations = gym.locations || [];
    if (!Array.isArray(locations)) continue; // skip non-array
    
    // Create new locations with radius=25 for all entries
    const newLocations = locations.map(loc => ({
      ...loc,
      radius: 25
    }));
    
    // Patch the gym
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/partners/${gym.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          locations: newLocations
        })
      });
      
      if (res.ok) {
        updated++;
      } else {
        console.error('PATCH failed for gym', gym.id, 'status:', res.status);
        failed++;
      }
    } catch (err) {
      console.error('PATCH error for gym', gym.id, 'error:', err);
      failed++;
    }
  }
  
  console.log('Summary:', updated, 'updated, ', unchanged, 'unchanged, ', failed, 'failed');
  return { updated, unchanged, failed };
};

// Verification fetch
const verifyGymRadii = async () => {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/partners?category=eq.gym`, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    const data = await res.json();
    
    let radius25 = 0, radiusNot25 = 0;
    for (const gym of data.data || []) {
      const locations = gym.locations || [];
      for (const loc of locations) {
        radius25 += loc.radius === 25 ? 1 : 0;
        radiusNot25 += loc.radius !== 25 ? 1 : 0;
      }
    }
    
    console.log('Verification:', radius25, 'gym locations have radius=25, ', radiusNot25, 'have non-25');
  } catch (err) {
    console.error('Verification fetch error:', err);
  }
};

// Run everything
(async () => {
  const gyms = await fetchGyms();
  const { updated, unchanged, failed } = await updateGymLocations(gyms);
  await verifyGymRadii();
})();
