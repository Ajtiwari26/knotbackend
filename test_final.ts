import { GroqService } from './src/services/groq.service';

async function test() {
  const youtubeId = 'jSkBtDg-8lg';
  console.log(`\n🚀 TESTING ULTRA-FAST GROQ KNOTTING FOR: ${youtubeId}\n`);
  
  try {
    const result = await GroqService.analyzeWithTranscript(youtubeId);
    console.log('✅ TEST SUCCESSFUL!');
    console.log('--------------------------------------------------');
    console.log('📊 VIBE:', result.vibe_check || result.summary);
    
    console.log('\n🧠 SECTIONS:');
    result.sections.forEach(s => console.log(`   [${Math.round(s.start_ms / 1000)}s] ${s.title}`));
    
    console.log('\n🪢 KNOTS (SKIPS):');
    result.junctions.forEach(j => {
      const dur = (j.end_ms - j.start_ms) / 1000;
      console.log(`   SKIP: ${Math.round(j.start_ms / 1000)}s -> ${Math.round(j.end_ms / 1000)}s (${dur.toFixed(1)}s)`);
    });
    console.log('--------------------------------------------------');
  } catch (e) {
    console.error('❌ FAILED:', (e as Error).message);
  }
}

test();
