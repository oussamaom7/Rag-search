import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import mammoth from 'mammoth';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseStorage = createClient(url, serviceKey || anonKey);
const supabase = createClient(url, anonKey);
const supabaseAdmin = createClient(url, serviceKey || anonKey);

type PdfParserError = {
  parserError?: string;
};

type PdfTextRun = {
  T?: string;
};

type PdfText = {
  R?: PdfTextRun[];
};

type PdfPage = {
  Texts?: PdfText[];
};

type PdfData = {
  Pages?: PdfPage[];
};

type PdfParserInstance = {
  on(event: 'pdfParser_dataError', handler: (err: PdfParserError) => void): void;
  on(event: 'pdfParser_dataReady', handler: (data: PdfData) => void): void;
  parseBuffer(buffer: Buffer): void;
};

type PdfParserConstructor = new (param: null, parseRawText: boolean) => PdfParserInstance;

function safeDecodeURIComponent(str: string): string {
  try { 
    return decodeURIComponent(str); 
  } catch { 
    try { 
      return decodeURIComponent(str.replace(/%/g, '%25')); 
    } catch { 
      return str; 
    } 
  }
}

async function extractTextFromFile(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith('.pdf')) {
    const PDFParser = (await import('pdf2json')).default as unknown as PdfParserConstructor;
    return new Promise((resolve, reject) => {
      const pdfParser = new PDFParser(null, true);
      pdfParser.on('pdfParser_dataError', (err) => 
        reject(new Error(`PDF parsing error: ${err.parserError || 'Unknown error'}`))
      );
      pdfParser.on('pdfParser_dataReady', (pdfData) => {
        try {
          let fullText = '';
          pdfData.Pages?.forEach((page) => 
            page.Texts?.forEach((text) => 
              text.R?.forEach((r) => 
                r.T && (fullText += safeDecodeURIComponent(r.T) + ' ')
              )
            )
          );
          resolve(fullText.trim());
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          reject(new Error(`Error extracting text: ${message}`));
        }
      });
      pdfParser.parseBuffer(buffer);
    });
  } else if (fileName.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } else if (fileName.endsWith('.txt')) {
    return buffer.toString('utf-8');
  } else {
    throw new Error('Unsupported file type. Please upload PDF, DOCX, or TXT files.');
  }
}

export async function POST(req: Request) {
  try {
    const file = (await req.formData()).get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const documentId = crypto.randomUUID();
    const uploadDate = new Date().toISOString();
    const filePath = `${documentId}.${file.name.split('.').pop() || 'bin'}`;

    // Upload file to Supabase Storage
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const { error: storageError } = await supabaseStorage.storage
      .from('documents')
      .upload(filePath, fileBuffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (storageError) {
      const msg = storageError.message || 'Unknown storage error';
      if (msg.includes('row-level security') || msg.includes('RLS')) {
        return NextResponse.json({ 
          success: false, 
          error: `Storage RLS error: ${msg}. Ensure SUPABASE_SERVICE_ROLE_KEY is set.` 
        }, { status: 500 });
      }
      return NextResponse.json({ 
        success: false, 
        error: `Failed to store file: ${msg}` 
      }, { status: 500 });
    }

    // Get public URL for the file
    const { data: urlData } = supabaseStorage.storage
      .from('documents')
      .getPublicUrl(filePath);

    // Extract text from file
    const text = await extractTextFromFile(file);
    if (!text || text.trim().length === 0) {
      return NextResponse.json({ 
        error: 'Could not extract text from file' 
      }, { status: 400 });
    }

    // Split text into chunks
    // Chunk size of 800 characters with 100-character overlap ensures
    // we don't lose context at chunk boundaries
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 800,
      chunkOverlap: 100,
    });
    const chunks = await textSplitter.splitText(text);

    // Process each chunk: generate embedding and store in database
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Generate embedding using OpenAI
      // This converts the text chunk into a 1536-dimensional vector
      const cohereResponse = await fetch('https://api.cohere.ai/v1/embed', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.COHERE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'embed-english-v3.0',
          texts: [chunk],
          input_type: 'search_document',
        }),
      });

      if (!cohereResponse.ok) {
        const errorText = await cohereResponse.text();
        return NextResponse.json({
          success: false,
          error: errorText || 'Cohere embed failed',
        }, { status: 500 });
      }

      const cohereData = (await cohereResponse.json()) as { embeddings: number[][] };
      const embedding = cohereData.embeddings?.[0];
      if (!embedding) {
        return NextResponse.json({
          success: false,
          error: 'Missing Cohere embedding',
        }, { status: 500 });
      }

      // Store chunk with embedding in database
      const { error } = await supabaseAdmin.from('documents').insert({
        content: chunk,
        metadata: { 
          source: file.name,
          document_id: documentId,
          file_name: file.name,
          file_type: file.type || file.name.split('.').pop(),
          file_size: file.size,
          upload_date: uploadDate,
          chunk_index: i,
          total_chunks: chunks.length,
          file_path: filePath,
          file_url: urlData.publicUrl,
        },
        embedding: JSON.stringify(embedding),
      });

      if (error) {
        return NextResponse.json({ 
          success: false, 
          error: error.message 
        }, { status: 500 });
      }
    }

    return NextResponse.json({ 
      success: true, 
      documentId, 
      fileName: file.name, 
      chunks: chunks.length, 
      textLength: text.length, 
      fileUrl: urlData.publicUrl 
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process file';
    return NextResponse.json({ 
      success: false, 
      error: message 
    }, { status: 500 });
  }
}