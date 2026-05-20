import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!
);
const openai = new OpenAI();

type MatchResult = {
  content: string;
  metadata?: Record<string, unknown>;
};

export async function POST(req: Request) {
  try {
    const { query } = await req.json();

    // Generate embedding for the user's query
    // This converts the search query into the same vector space as document chunks
    const emb = await openai.embeddings.create({ 
      model: 'text-embedding-3-small', 
      input: query 
    });

    // Find similar documents using vector similarity search
    // The match_documents function finds the 5 most similar chunks
    const { data: results, error } = await supabase.rpc('match_documents', {
      query_embedding: JSON.stringify(emb.data[0].embedding),
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
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
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
      answer: completion.choices[0].message.content, 
      sources: typedResults 
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}