import { createClient } from '@supabase/supabase-js';
import Groq from 'groq-sdk';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!
);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

type MatchResult = {
  content: string;
  metadata?: Record<string, unknown>;
};

export async function POST(req: Request) {
  try {
    const { query } = await req.json();

    // Generate embedding for the user's query
    // This converts the search query into the same vector space as document chunks
    const cohereResponse = await fetch('https://api.cohere.ai/v1/embed', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.COHERE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'embed-english-v3.0',
        texts: [query],
        input_type: 'search_query',
      }),
    });

    if (!cohereResponse.ok) {
      const errorText = await cohereResponse.text();
      return NextResponse.json({ error: errorText || 'Cohere embed failed' }, { status: 500 });
    }

    const cohereData = (await cohereResponse.json()) as { embeddings: number[][] };
    const queryEmbedding = cohereData.embeddings?.[0];
    if (!queryEmbedding) {
      return NextResponse.json({ error: 'Missing Cohere embedding' }, { status: 500 });
    }

    // Find similar documents using vector similarity search
    // The match_documents function finds the 5 most similar chunks
    const { data: results, error } = await supabase.rpc('match_documents', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: 0.0,  // Accept any similarity (you can increase this for stricter matching)
      match_count: 5,        // Return top 5 most similar chunks
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Combine retrieved chunks into context
    // These chunks will be used as context for the AI to generate an answer
    const typedResults = (results as MatchResult[] | null) || [];
    const context = typedResults.map((r) => r.content).join('\n---\n') || '';

    // Generate answer using OpenAI with retrieved context
    // This is the "Generation" part of RAG
    const completion = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [
        { 
          role: 'system', 
          content: 'You are a helpful assistant. Use the provided context to answer questions. If the answer is not in the context, say you do not know.' 
        },
        { 
          role: 'user', 
          content: `Context: ${context}\n\nQuestion: ${query}` 
        }
      ],
    });

    return NextResponse.json({ 
      answer: completion.choices[0].message.content || '', 
      sources: typedResults 
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}