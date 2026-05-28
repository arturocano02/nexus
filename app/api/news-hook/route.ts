import { NextResponse } from "next/server";
import { anthropic, MODEL } from "@/lib/anthropic";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BBC_RSS_URLS = [
  "https://feeds.bbci.co.uk/news/politics/rss.xml",
  "https://feeds.bbci.co.uk/news/uk/rss.xml",
];

async function fetchHeadlines(): Promise<string[]> {
  for (const url of BBC_RSS_URLS) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Nexus/1.0" },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const xml = await res.text();

      // Extract <title> tags (skip the first one — it's the feed title)
      const matches = [...xml.matchAll(/<title>(?:<!\[CDATA\[)?([\s\S]+?)(?:\]\]>)?<\/title>/g)];
      const headlines = matches
        .slice(1, 10)
        .map(m => m[1].trim())
        .filter(t => t.length > 10 && !t.startsWith("BBC"));

      if (headlines.length >= 3) return headlines;
    } catch { /* try next */ }
  }
  return [];
}

export async function GET() {
  const headlines = await fetchHeadlines();

  const headlineBlock = headlines.length > 0
    ? headlines.slice(0, 6).map((h, i) => `${i + 1}. ${h}`).join("\n")
    : "No live headlines available — pick a hot UK political topic from the past week.";

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 120,
    messages: [
      {
        role: "user",
        content: `You are Nexus, a sharp political debate advisor. Here are today's UK news headlines:

${headlineBlock}

Pick the most politically interesting one and write a single conversational opening line (1-2 sentences max) that:
- Naturally references the story without being formal
- Ends with a question like "how does that land with you?" or "what do you make of it?" or similar
- Sounds like a smart, curious friend — not a newsreader
- Is under 35 words total

Return ONLY a JSON object: {"text":"your opening line","topic":"the political topic name e.g. Housing"}`,
      },
    ],
  });

  const raw = resp.content.find(c => c.type === "text")?.text ?? "";
  try {
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(s, e + 1));
    if (parsed.text) {
      return NextResponse.json({ text: parsed.text, topic: parsed.topic ?? null });
    }
  } catch { /* fall through */ }

  // Fallback
  return NextResponse.json({
    text: "The government is taking a lot of heat right now — what issue do you think they're getting most wrong?",
    topic: null,
  });
}
