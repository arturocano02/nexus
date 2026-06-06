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
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `You are Nexus, a sharp political debate advisor. Here are today's UK news headlines:

${headlineBlock}

Pick the most politically interesting one and return a JSON object with:
- "text": a single conversational opening line (under 35 words) that naturally references the story and ends with a question like "how does that land with you?" — sounds like a smart curious friend, not a newsreader
- "topic": the political topic category e.g. "Housing"
- "headline": the exact headline you chose from the list
- "context": 2-3 plain English sentences explaining what this story is about and why it matters, written for someone who hasn't been following the news

Return ONLY valid JSON: {"text":"...","topic":"...","headline":"...","context":"..."}`,
      },
    ],
  });

  const raw = resp.content.find(c => c.type === "text")?.text ?? "";
  try {
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(s, e + 1));
    if (parsed.text) {
      return NextResponse.json({
        text: parsed.text,
        topic: parsed.topic ?? null,
        headline: parsed.headline ?? null,
        context: parsed.context ?? null,
      });
    }
  } catch { /* fall through */ }

  return NextResponse.json({
    text: "The government is taking a lot of heat right now — what issue do you think they're getting most wrong?",
    topic: null,
    headline: null,
    context: null,
  });
}
