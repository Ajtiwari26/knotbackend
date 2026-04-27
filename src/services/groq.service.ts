import { YoutubeTranscript } from 'youtube-transcript';

const GROQ_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5,
  process.env.GROQ_API_KEY_6,
  process.env.GROQ_API_KEY_7,
  process.env.GROQ_API_KEY_8,
  process.env.GROQ_API_KEY_9,
  process.env.GROQ_API_KEY_10,
  process.env.GROQ_API_KEY_11
].filter(Boolean) as string[];

// Fallback if no keys are in env
if (GROQ_KEYS.length === 0) {
  console.warn('[GroqService] No GROQ_API_KEYs found in environment variables!');
}

let currentKeyIndex = 0;

export interface GroqKnotResult {
  junctions: { start_ms: number; end_ms: number; reason: string }[];
  sections: { start_ms: number; title: string }[];
  lyrics?: string;
  summary?: string;
  vibe_check?: string;
}

export class GroqService {
  /**
   * Load Balancer: Get the next API key in a round-robin fashion
   */
  private static getNextKey(): string {
    const key = GROQ_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
    return key;
  }

  /**
   * Ultra-Fast Analysis using Groq + Transcripts
   */
  static async analyzeWithTranscript(youtubeId: string): Promise<GroqKnotResult> {
    console.log(`[Groq] Fetching transcript for ${youtubeId}...`);
    
    let transcriptData;
    let transcriptText = '';

    try {
      transcriptData = await YoutubeTranscript.fetchTranscript(youtubeId);
      transcriptText = transcriptData
        .map(t => `[${Math.round(t.offset)}ms] ${t.text}`)
        .join('\n');
    } catch (e) {
      console.warn(`[Groq] Primary transcript fetch failed for ${youtubeId}, trying mirror fallback...`);
      
      // Fallback: Try Piped API for captions
      try {
        const res = await fetch(`https://pipedapi.kavin.rocks/captions/${youtubeId}`);
        if (res.ok) {
          const captions = await res.json();
          const track = captions.find((t: any) => t.language === 'en') || captions[0];
          if (track?.url) {
            const transcriptRes = await fetch(track.url);
            transcriptText = await transcriptRes.text(); // This might be VTT/SRT, Groq can handle it
          }
        }
      } catch (mirrorErr) {
        console.error('[Groq] Mirror transcript fallback also failed.');
      }
    }

    if (!transcriptText) {
      throw new Error('No transcript available for this video (All methods failed).');
    }

    // Save for user inspection
    try {
      const fs = require('fs');
      const path = require('path');
      const logDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
      fs.writeFileSync(path.join(logDir, 'latest_transcript.txt'), transcriptText);
      console.log(`[Groq] Transcript saved to logs/latest_transcript.txt`);
    } catch (e) {
      console.warn('[Groq] Failed to save transcript file.');
    }

    const activeKey = this.getNextKey();
    console.log(`[Groq] Using API Key Index: ${currentKeyIndex - 1} (Load Balanced)`);

    const systemPrompt = `
      You are the "Knot" AI Music Editor.
      
      RULES:
      1. SECTIONS: Only include meaningful, sustained lyrical stanzas. NEVER include [संगीत] or [प्रशंसा] in the 'sections' array.
      2. FRAGMENTS: If a tiny phrase (1-3 words) appears and is followed by a long instrumental gap (> 5s), it is an "Intro Fragment" or "Ad-lib"—KNOT it and do NOT make it a section.
      3. KNOT all instrumental gaps > 4 seconds.
      4. Use RAW transcript timestamps.
      5. Output VALID JSON only.

      JSON STRUCTURE:
      {
        "junctions": [{"start_ms": number, "end_ms": number, "reason": "string"}],
        "sections": [{"start_ms": number, "title": "string", "lyrics": "string"}],
        "summary": "string",
        "vibe_check": "string"
      }
    `;

    const userPrompt = `Transcript:\n${transcriptText.slice(0, 32000)}`;

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${activeKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Groq API Error: ${err}`);
      }

      const data = await response.json();
      const result = JSON.parse(data.choices[0].message.content);

      // --- POST-PROCESSING (Bulletproof Math) ---
      
      // 1. Apply 1s Buffer to all sections
      if (result.sections) {
        result.sections = result.sections.map((s: any) => ({
          ...s,
          start_ms: Math.max(0, s.start_ms - 1000)
        }));
      }

      // 2. Ensure Intro Knot (0 to first section)
      if (result.sections && result.sections.length > 0) {
        const firstStart = result.sections[0].start_ms;
        if (firstStart > 5000) { // If intro is > 5s
          result.junctions = [
            { start_ms: 0, end_ms: firstStart, reason: "Aggressive Intro Knot" },
            ...(result.junctions || [])
          ];
        }
      }

      // Save for user analysis
      try {
        const fs = require('fs');
        const path = require('path');
        fs.writeFileSync(path.join(process.cwd(), 'logs', 'latest_knots.json'), JSON.stringify(result, null, 2));
      } catch (e) {}
      
      console.log(`[Groq] Instant analysis complete for ${youtubeId}`);
      return result;
    } catch (error) {
      console.error(`[Groq] Request failed:`, error);
      throw error;
    }
  }

  /**
   * Client-Provided Transcript Analysis (The "Courier" Method)
   */
  static async analyzeClientTranscript(transcriptText: string, youtubeId: string): Promise<GroqKnotResult> {
    console.log(`[Groq] Analyzing client-provided transcript for ${youtubeId}...`);
    
    const activeKey = this.getNextKey();
    const systemPrompt = `
      You are the "Knot" AI Music Editor. Your job is to analyze a timestamped transcript and identify "Lyrical Stanzas" to KEEP and "Boring/Non-Lyrical Parts" to KNOT (skip).

      STRATEGY:
      1. Identify ONLY the stanzas with lyrics.
      2. Intro (0ms to first lyric) is ALWAYS a KNOT.
      3. Outro (last lyric to end) is ALWAYS a KNOT.
      4. Instrumental breaks > 5s are KNOTS.

      OUTPUT ONLY VALID JSON:
      {
        "junctions": [{"start_ms": number, "end_ms": number, "reason": "string"}],
        "sections": [{"start_ms": number, "title": "string", "lyrics": "string"}],
        "summary": "string",
        "vibe_check": "string"
      }
    `;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${activeKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `YouTube ID: ${youtubeId}\nTranscript:\n${transcriptText.slice(0, 32000)}` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      })
    });

    if (!response.ok) throw new Error(`Groq Error: ${await response.text()}`);
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  }
}
