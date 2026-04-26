const { GroqService } = require('./dist/services/groq.service');
const dotenv = require('dotenv');
dotenv.config();

// Manual test for the specific song
async function runTest() {
  const youtubeId = 'jSkBtDg-8lg';
  console.log(`\n🚀 TESTING ULTRA-FAST GROQ KNOTTING FOR: ${youtubeId}\n`);
  
  try {
    const result = await GroqService.analyzeWithTranscript(youtubeId);
    
    console.log('✅ TEST SUCCESSFUL!');
    console.log('--------------------------------------------------');
    console.log('📊 VIBE CHECK:', result.vibe_check || result.summary);
    console.log('\n🧠 SECTIONS FOUND (STANZAS):');
    result.sections.forEach(s => {
      console.log(`   [${Math.round(s.start_ms / 1000)}s] - ${s.title}`);
    });
    
    console.log('\n🪢 GENERATED KNOTS (BORING PARTS TO SKIP):');
    result.junctions.forEach(j => {
      const dur = (j.end_ms - j.start_ms) / 1000;
      console.log(`   SKIP: ${Math.round(j.start_ms / 1000)}s -> ${Math.round(j.end_ms / 1000)}s (${dur.toFixed(1)}s) - ${j.reason}`);
    });
    console.log('--------------------------------------------------');
  } catch (error) {
    console.error('❌ TEST FAILED:', error.message);
  }
}

runTest();
