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
    try {
      transcriptData = await YoutubeTranscript.fetchTranscript(youtubeId);
    } catch (e) {
      console.warn(`[Groq] No transcript found for ${youtubeId}`);
      throw new Error('No transcript available for this video.');
    }

    const transcriptText = transcriptData
      .map(t => `[${Math.round(t.offset)}ms] ${t.text}`)
      .join('\n');

    const activeKey = this.getNextKey();
    console.log(`[Groq] Using API Key Index: ${currentKeyIndex - 1} (Load Balanced)`);

    const systemPrompt = `
      You are the "Knot" AI Music Editor. Your job is to analyze a timestamped transcript and identify "Lyrical Stanzas" to KEEP and "Boring/Non-Lyrical Parts" to KNOT (skip).

      STRATEGY:
      1. Identify ONLY the stanzas with lyrics. These are your "Islands of Interest."
      2. Everything that is NOT a lyrical stanza is a KNOT. This includes:
         - The Instrumental Intro (from 0ms to the first lyric).
         - Long Instrumental Breaks (music-only gaps between stanzas > 5 seconds).
         - The Instrumental Outro (from the last lyric to the end).
         - Redundant repeated choruses (keep the first two, knot the rest if the song is > 4 mins).

      TASK:
      - Extract the 'junctions' (knots) for all non-lyrical parts.
      - Extract the 'sections' (stanzas) with their cleaned-up lyrics as titles.

      OUTPUT ONLY VALID JSON:
      {
        "junctions": [{"start_ms": number, "end_ms": number, "reason": "string"}],
        "sections": [{"start_ms": number, "title": "string", "lyrics": "string"}],
        "summary": "1-sentence summary of the song's energy",
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
          response_format: { type: 'json_object' },
          temperature: 0.1
        })
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Groq API Error: ${err}`);
      }

      const data = await response.json();
      const result = JSON.parse(data.choices[0].message.content);
      
      console.log(`[Groq] Instant analysis complete for ${youtubeId}`);
      return result;
    } catch (error) {
      console.error(`[Groq] Request failed:`, error);
      throw error;
    }
  }
}
