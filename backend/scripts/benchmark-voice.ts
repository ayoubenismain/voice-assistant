import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FormData, File } from 'undici';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runBenchmark(audioFilePath: string, saveResponse: boolean = false) {
  if (!fs.existsSync(audioFilePath)) {
    console.error(`Audio file not found: ${audioFilePath}`);
    process.exit(1);
  }

  const audioBuffer = fs.readFileSync(audioFilePath);
  const fileName = path.basename(audioFilePath);
  const file = new File([audioBuffer], fileName, { type: 'audio/wav' });

  const formData = new FormData();
  formData.append('file', file);

  const targetUrl = 'http://localhost:3001/api/voice/respond?debug=true';
  console.log(`Sending benchmark request to: ${targetUrl}`);
  console.log(`Audio file: ${fileName} (${audioBuffer.length} bytes)`);

  const startMs = Date.now();

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      body: formData,
    });

    const wallClockMs = Date.now() - startMs;

    console.log(`\n--- BENCHMARK RESULTS ---`);
    console.log(`HTTP Status: ${response.status}`);
    console.log(`Content-Type: ${response.headers.get('content-type')}`);
    
    const arrayBuffer = await response.arrayBuffer();
    console.log(`Response Bytes: ${arrayBuffer.byteLength}`);

    console.log(`\n--- SERVER TIMINGS ---`);
    console.log(`STT:        ${response.headers.get('x-voice-stt-ms') || '-'} ms`);
    console.log(`Retrieval:  ${response.headers.get('x-assistant-retrieval-ms') || '-'} ms`);
    console.log(`Context:    ${response.headers.get('x-assistant-context-ms') || '-'} ms`);
    console.log(`Generation: ${response.headers.get('x-assistant-generation-ms') || '-'} ms`);
    console.log(`Assistant:  ${response.headers.get('x-voice-assistant-ms') || '-'} ms`);
    console.log(`TTS:        ${response.headers.get('x-voice-tts-ms') || '-'} ms`);
    console.log(`Total:      ${response.headers.get('x-voice-total-ms') || '-'} ms`);
    console.log(`Type:       ${response.headers.get('x-assistant-type') || '-'}`);
    
    console.log(`\nClient Wall Clock: ${wallClockMs} ms`);

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok && contentType.includes('application/json')) {
      try {
        const text = Buffer.from(arrayBuffer).toString('utf-8');
        const json = JSON.parse(text);
        console.log(`\n--- ERROR RESPONSE ---`);
        console.log(JSON.stringify(json, null, 2));
      } catch (e) {
        console.log(`\n--- ERROR RESPONSE (Failed to parse JSON) ---`);
      }
    } else if (saveResponse && response.status === 200) {
      const outPath = path.join(process.cwd(), 'benchmark-response.wav');
      fs.writeFileSync(outPath, Buffer.from(arrayBuffer));
      console.log(`\nResponse saved to: ${outPath}`);
    }

  } catch (error: any) {
    console.error(`\nRequest failed: ${error.message}`);
  }
}

const args = process.argv.slice(2);
const audioFile = args[0] || 'question.wav';
const shouldSave = args.includes('--save');

runBenchmark(path.resolve(process.cwd(), audioFile), shouldSave);
